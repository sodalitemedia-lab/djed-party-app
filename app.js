(function(){

  // ---------------- firebase ----------------
  firebase.initializeApp(firebaseConfig);
  var db = firebase.database();

  // ---------------- data ----------------
  var ALL_CHARACTERS = ['spidey','ghostspider','spin','docock','rhino','greengoblin'];

  var CHARACTER_INFO = {
    spidey:      {name:'Spidey',        team:'hero',    emoji:'🕷️'},
    ghostspider: {name:'Ghost-Spider',  team:'hero',    emoji:'👻'},
    spin:        {name:'Spin',          team:'hero',    emoji:'🕸️'},
    docock:      {name:'Doc Ock',       team:'villain', emoji:'🦑'},
    rhino:       {name:'Rhino',         team:'villain', emoji:'🦏'},
    greengoblin: {name:'Green Goblin',  team:'villain', emoji:'🎃'}
  };

  // Stops on the museum trail — deliberately vague, just enough to pick a
  // co-leader per stop without spoiling the envelope/clue mechanic.
  var STOPS = ['Stop 1', 'Stop 2', 'Stop 3', 'Stop 4'];

  var DEFAULT_SETTINGS = {
    venueName: 'Iziko South African Museum',
    venueAddress: "25 Queen Victoria Street, Gardens, Cape Town",
    eventDate: 'Sunday, 13 September 2026',
    eventTime: '1:00 PM',
    entryFeeNote: "Museum entry is R60/adult, R30/child — each guest covers their own admission at the door.",
    driveLink: 'https://drive.google.com/drive/folders/10hgq4f6ciIKKRaompc_T8dlf2uKA2k1S?usp=sharing',
    rsvpNote: "Come dressed as your favourite hero or villain if you like — totally optional!",
    rsvpDeadline: '2026-09-11',
    rsvpReopened: false
  };

  // ---------------- small helpers ----------------
  function uid(){
    return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
  }

  function esc(s){
    var d = document.createElement('div');
    d.textContent = s == null ? '' : s;
    return d.innerHTML;
  }

  var ROMAN = [[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  function toRoman(n){
    var out = '';
    for(var i=0;i<ROMAN.length;i++){
      while(n >= ROMAN[i][0]){ out += ROMAN[i][1]; n -= ROMAN[i][0]; }
    }
    return out;
  }

  function localGet(key){
    try{ return window.localStorage.getItem(key); }catch(e){ return null; }
  }
  function localSet(key, value){
    try{ window.localStorage.setItem(key, value); }catch(e){}
  }
  function sessionGet(key){
    try{ return window.sessionStorage.getItem(key); }catch(e){ return null; }
  }
  function sessionSet(key, value){
    try{ window.sessionStorage.setItem(key, value); }catch(e){}
  }

  // ---------------- toast ----------------
  var toastEl = document.getElementById('toast');
  var toastTimer;
  function toast(msg){
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove('show'); }, 2400);
  }

  // ---------------- state ----------------
  var state = {
    tab: 'invite',
    settings: Object.assign({}, DEFAULT_SETTINGS),
    guests: [],
    rsvps: [],
    myGuestId: localGet('djed-my-guest-id'),
    pendingCharacterKey: null,
    pendingGuestId: null,   // one id per check-in, so retries overwrite instead of duplicating
    saving: false,          // lives in state (not on the button) so re-renders can't reset the guard
    rolling: false,
    guestNameInput: '',
    rsvpNameInput: '',
    rsvpHeadcountInput: 1,
    submittingRsvp: false,
    spinNames: [],
    spinning: false,
    coLeader: null,
    coLeaderGame: STOPS[0],
    adminAuthed: sessionGet('djed-admin-authed') === '1',
    adminPasswordInput: '',
    adminLoginError: ''
  };

  // ---------------- character queue (balanced, self-extending) ----------------
  function shuffledCycle(){
    var arr = ALL_CHARACTERS.slice();
    for(var i = arr.length - 1; i > 0; i--){
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function ensureQueueCovers(claimedIndex){
    return db.ref('characterQueue').once('value').then(function(snap){
      var queue = snap.val() || [];
      while(queue.length <= claimedIndex){
        queue = queue.concat(shuffledCycle());
      }
      return db.ref('characterQueue').set(queue).then(function(){ return queue; });
    });
  }

  function claimCharacterKey(){
    return db.ref('characterQueueIndex').transaction(function(current){
      return (current || 0) + 1;
    }).then(function(result){
      if(!result.committed) throw new Error('claim not committed');
      var newIndex = result.snapshot.val();
      var claimedIndex = newIndex - 1;
      return ensureQueueCovers(claimedIndex).then(function(queue){
        return queue[claimedIndex];
      });
    });
  }

  // ---------------- loads ----------------
  function loadSettings(){
    return db.ref('settings').once('value').then(function(snap){
      var val = snap.val();
      if(val) state.settings = Object.assign({}, DEFAULT_SETTINGS, val);
    });
  }

  function guestsObjectToArray(obj){
    var list = [];
    if(obj){
      Object.keys(obj).forEach(function(id){
        var g = obj[id];
        list.push(Object.assign({id:id}, g));
      });
    }
    list.sort(function(a,b){ return (a.ts||0)-(b.ts||0); });
    return list;
  }

  function rsvpsObjectToArray(obj){
    var list = [];
    if(obj){
      Object.keys(obj).forEach(function(id){
        list.push(Object.assign({id:id}, obj[id]));
      });
    }
    list.sort(function(a,b){ return (a.ts||0)-(b.ts||0); });
    return list;
  }

  function ensureDefaultAdminPassword(){
    return db.ref('adminAuth/password').once('value').then(function(snap){
      if(!snap.val()){
        return db.ref('adminAuth/password').set(DEFAULT_ADMIN_PASSWORD);
      }
    });
  }

  // ---------------- realtime listeners ----------------
  function attachListeners(){
    db.ref('guests').on('value', function(snap){
      state.guests = guestsObjectToArray(snap.val());
      if(state.tab === 'capsule' || state.tab === 'suitup' || state.tab === 'spin' || state.tab === 'admin') render();
    });
    db.ref('rsvps').on('value', function(snap){
      state.rsvps = rsvpsObjectToArray(snap.val());
      if(state.tab === 'rsvp' || state.tab === 'admin') render();
    });
    db.ref('coLeader').on('value', function(snap){
      var val = snap.val();
      if(val){ state.coLeader = val.name; state.coLeaderGame = val.game || state.coLeaderGame; }
      if(state.tab === 'spin' && !state.spinning) render();
    });
    db.ref('settings').on('value', function(snap){
      var val = snap.val();
      if(val) state.settings = Object.assign({}, DEFAULT_SETTINGS, val);
      if(state.tab === 'invite' || state.tab === 'rsvp' || state.tab === 'admin') render();
    });
  }

  // ---------------- render root ----------------
  var screen = document.getElementById('screen');
  var tabbar = document.getElementById('tabbar');

  function setTab(t){
    state.tab = t;
    Array.prototype.forEach.call(tabbar.querySelectorAll('button'), function(b){
      b.classList.toggle('active', b.getAttribute('data-tab')===t);
    });
    render();
  }
  tabbar.addEventListener('click', function(e){
    var btn = e.target.closest('button[data-tab]');
    if(btn) setTab(btn.getAttribute('data-tab'));
  });

  document.getElementById('settingsBtn').addEventListener('click', function(){
    setTab(state.adminAuthed ? 'admin' : 'adminlogin');
  });

  // ---------------- INVITE TAB ----------------
  function renderInvite(){
    screen.innerHTML =
      '<div class="panel">'+
        '<span class="eyebrow">You\'re Invited</span>'+
        '<h2>A Spidey Treasure Hunt Awaits</h2>'+
        '<p>Djed is turning 4! Everyone\'s assigned a hero or villain from Spidey\'s world — we\'re all on the same team today, working together to help Djed complete his mission.</p>'+
      '</div>'+
      '<div class="panel">'+
        '<span class="eyebrow">Where &amp; When</span>'+
        '<p>📅 <strong>'+esc(state.settings.eventDate)+' — '+esc(state.settings.eventTime)+'</strong></p>'+
        '<p>📍 <strong>'+esc(state.settings.venueName)+'</strong><br>'+esc(state.settings.venueAddress)+'</p>'+
        '<p>🎟️ <strong>'+esc(state.settings.entryFeeNote)+'</strong></p>'+
        '<p style="margin-top:10px; opacity:0.75; font-size:13px;">'+esc(state.settings.rsvpNote)+'</p>'+
      '</div>'+
      '<div class="panel">'+
        '<span class="eyebrow">The Mission</span>'+
        '<h2>🕸️ Spidey Needs Your Help</h2>'+
        '<p>Spidey needs the Heroes &amp; Villains to team up! Djed will lead everyone on a trail through the museum — sea creatures, land animals, and ancient dinosaurs — following clues along the way. Work together, follow Djed\'s lead, and stick around for the big reveal at the end (hint: it\'s sweet).</p>'+
        '<p>When the mission\'s complete, we\'ll gather outside for cake and sing Happy Birthday to Djed!</p>'+
      '</div>'+
      '<div class="panel">'+
        '<span class="eyebrow">How To Use This App</span>'+
        '<h2>Your Next Steps</h2>'+
        '<div class="game-card"><div class="gtitle">📩 1. RSVP</div><p>Let us know you\'re coming (and how many people!) before the deadline — see the RSVP tab for the countdown.</p></div>'+
        '<div class="game-card"><div class="gtitle">🕸️ 2. Suit Up</div><p>Get randomly assigned your hero or villain, then add a photo so we know your face for the mission.</p></div>'+
        '<div class="game-card"><div class="gtitle">🎯 3. Spin</div><p>On the day, Djed\'s helpers spin the wheel at each stop to pick a co-leader — it could be you!</p></div>'+
        '<div class="game-card"><div class="gtitle">📸 4. Capsule</div><p>After the big day, come back to see the whole squad and grab the shared photos.</p></div>'+
      '</div>'+
      '<button class="btn blue" id="goRsvp">📩 RSVP Now →</button>';

    document.getElementById('goRsvp').addEventListener('click', function(){ setTab('rsvp'); });
  }

  // ---------------- RSVP TAB ----------------
  var rsvpCountdownTimer = null;

  function rsvpIsOpen(){
    if(state.settings.rsvpReopened) return true;
    var deadline = new Date(state.settings.rsvpDeadline + 'T23:59:59');
    return Date.now() <= deadline.getTime();
  }

  function countdownParts(){
    var deadline = new Date(state.settings.rsvpDeadline + 'T23:59:59').getTime();
    var diff = Math.max(0, deadline - Date.now());
    var days = Math.floor(diff / 86400000);
    var hours = Math.floor((diff % 86400000) / 3600000);
    var mins = Math.floor((diff % 3600000) / 60000);
    return {days:days, hours:hours, mins:mins};
  }

  function renderRsvp(){
    var totalHeadcount = state.rsvps.reduce(function(sum, r){ return sum + (Number(r.headcount) || 0); }, 0);
    var open = rsvpIsOpen();

    var topHtml;
    if(open){
      var c = countdownParts();
      var countdownLabel = c.days > 0
        ? (c.days + 'd ' + c.hours + 'h left to RSVP')
        : (c.hours + 'h ' + c.mins + 'm left to RSVP');
      topHtml =
        '<div class="countdown-box"><div class="num">'+countdownLabel+'</div><div class="lbl">RSVP by '+esc(state.settings.rsvpDeadline)+'</div></div>'+
        '<div class="rsvp-total">Heading our way so far: <strong>'+totalHeadcount+'</strong> mission agents</div>'+
        '<label class="field-label">Your name</label>'+
        '<input type="text" id="rsvpName" placeholder="e.g. Robyn" value="'+esc(state.rsvpNameInput)+'">'+
        '<label class="field-label">How many people (including you)?</label>'+
        '<input type="number" id="rsvpHeadcount" min="1" value="'+esc(state.rsvpHeadcountInput)+'">'+
        '<button class="btn blue" id="rsvpSubmit" '+(state.submittingRsvp?'disabled':'')+'>'+(state.submittingRsvp?'Sending...':'📩 Send RSVP')+'</button>';
    } else {
      topHtml =
        '<div class="rsvp-closed">🕒 RSVPs are closed — see you at the party!<br><span style="opacity:0.7;">'+totalHeadcount+' mission agents confirmed</span></div>';
    }

    screen.innerHTML =
      '<div class="panel">'+
        '<span class="eyebrow">RSVP</span>'+
        '<h2>Let Us Know You\'re Coming</h2>'+
        '<p style="font-size:13px; opacity:0.75;">'+esc(state.settings.rsvpNote)+'</p>'+
        topHtml+
      '</div>';

    var nameInput = document.getElementById('rsvpName');
    if(nameInput) nameInput.addEventListener('input', function(e){ state.rsvpNameInput = e.target.value; });
    var headcountInput = document.getElementById('rsvpHeadcount');
    if(headcountInput) headcountInput.addEventListener('input', function(e){ state.rsvpHeadcountInput = e.target.value; });

    var submitBtn = document.getElementById('rsvpSubmit');
    if(submitBtn){
      submitBtn.addEventListener('click', function(){
        var name = (state.rsvpNameInput || '').trim();
        var headcount = parseInt(state.rsvpHeadcountInput, 10);
        if(!name){ toast('Type your name first!'); return; }
        if(!headcount || headcount < 1){ toast('Headcount must be at least 1.'); return; }
        state.submittingRsvp = true;
        render();
        db.ref('rsvps').push({name:name, headcount:headcount, ts:Date.now()}).then(function(){
          state.submittingRsvp = false;
          state.rsvpNameInput = '';
          state.rsvpHeadcountInput = 1;
          toast('RSVP received — see you there!');
          render();
        }).catch(function(){
          state.submittingRsvp = false;
          toast('Could not send RSVP, try again.');
          render();
        });
      });
    }

    clearInterval(rsvpCountdownTimer);
    if(open){
      rsvpCountdownTimer = setInterval(function(){ if(state.tab==='rsvp') render(); }, 60000);
    }
  }

  // ---------------- SUIT UP TAB ----------------
  function duplicateLabel(guest){
    var sameChar = state.guests
      .filter(function(g){ return g.characterKey === guest.characterKey; })
      .sort(function(a,b){ return (a.ts||0)-(b.ts||0); });
    var position = sameChar.findIndex(function(g){ return g.id === guest.id; }) + 1;
    return position <= 1 ? '' : ' ' + toRoman(position);
  }

  function renderSuitUp(){
    var mine = state.guests.find(function(g){ return g.id === state.myGuestId; });
    var chosenKey = mine ? mine.characterKey : state.pendingCharacterKey;
    var chosenInfo = chosenKey ? CHARACTER_INFO[chosenKey] : null;

    var revealHtml;
    if(state.rolling){
      revealHtml = '<div class="reveal-placeholder">Rolling the mission...</div>';
    } else if(chosenInfo){
      var teamLabel = chosenInfo.team === 'hero' ? 'HERO' : 'VILLAIN';
      var dupLabel = mine ? duplicateLabel(mine) : '';
      revealHtml = '<div class="reveal-emoji">'+chosenInfo.emoji+'</div>'+
        '<div class="reveal-name">'+esc(chosenInfo.name)+esc(dupLabel)+'</div>'+
        '<div class="reveal-team">'+teamLabel+'</div>';
    } else {
      revealHtml = '<div class="reveal-placeholder">Tap the button below<br>to get your mission</div>';
    }

    var photoHtml;
    var photoSrc = mine ? mine.photo : state.pendingPhoto;
    if(photoSrc){
      photoHtml = '<img class="photo-preview" src="'+photoSrc+'" alt="Your photo">';
    } else {
      photoHtml = '<label class="photo-upload-label" for="photoInput">📷 TAP TO TAKE / ADD YOUR PHOTO</label>';
    }

    screen.innerHTML =
      '<div class="panel">'+
        '<span class="eyebrow">Step 1</span>'+
        '<h2>What\'s Your Name?</h2>'+
        '<input type="text" id="nameInput" placeholder="Type your name" value="'+esc(mine ? mine.name : state.guestNameInput)+'" '+(mine?'disabled':'')+'>'+
        '<div class="reveal-stage">'+revealHtml+'</div>'+
        (mine || state.rolling || chosenInfo ? '' : '<button class="btn" id="rollBtn">🎲 Get My Mission</button>')+
      '</div>'+
      (chosenInfo ? (
      '<div class="panel">'+
        '<span class="eyebrow">Step 2 (optional)</span>'+
        '<h2>Add Your Photo</h2>'+
        photoHtml+
        '<input type="file" accept="image/*" capture="user" id="photoInput" hidden>'+
        (mine ? '' : '<button class="btn blue" id="saveBtn" '+(state.saving?'disabled':'')+'>'+(state.saving?'Saving...':'✅ Save &amp; Join the Capsule')+'</button>')+
        (mine ? '<p style="text-align:center; opacity:0.6; font-size:12px; margin-top:8px;">You\'re checked in! See everyone in the Capsule tab.</p>' : '')+
      '</div>') : '');

    var nameInput = document.getElementById('nameInput');
    if(nameInput){
      nameInput.addEventListener('input', function(e){ state.guestNameInput = e.target.value; });
    }

    var rollBtn = document.getElementById('rollBtn');
    if(rollBtn){
      rollBtn.addEventListener('click', function(){
        if(!state.guestNameInput || !state.guestNameInput.trim()){
          toast('Type your name first!');
          return;
        }
        state.rolling = true;
        render();

        var allKeys = ALL_CHARACTERS;
        var stage = document.querySelector('.reveal-stage');
        var i = 0, ticks = 10, delay = 60;
        var claimPromise = claimCharacterKey();
        var interval = setInterval(function(){
          if(stage){
            var r = CHARACTER_INFO[allKeys[Math.floor(Math.random()*allKeys.length)]];
            stage.innerHTML = '<div class="reveal-emoji">'+r.emoji+'</div><div class="reveal-name">'+esc(r.name)+'</div>';
          }
          i++;
          if(i >= ticks){
            clearInterval(interval);
            claimPromise.then(function(characterKey){
              state.rolling = false;
              state.pendingCharacterKey = characterKey;
              render();
            }).catch(function(){
              state.rolling = false;
              toast('Could not get a mission — check your connection and try again.');
              render();
            });
          }
        }, delay);
      });
    }

    var photoInput = document.getElementById('photoInput');
    if(photoInput){
      photoInput.addEventListener('change', function(e){
        var file = e.target.files[0];
        if(!file) return;
        var reader = new FileReader();
        reader.onload = function(ev){
          var img = new Image();
          img.onload = function(){
            var maxDim = 480;
            var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            var canvas = document.createElement('canvas');
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            var dataUrl = canvas.toDataURL('image/jpeg', 0.6);
            state.pendingPhoto = dataUrl;
            render();
          };
          img.onerror = function(){ toast('Could not read that photo, try another.'); };
          img.src = ev.target.result;
        };
        reader.onerror = function(){ toast('Could not read that photo.'); };
        reader.readAsDataURL(file);
      });
    }

    var saveBtn = document.getElementById('saveBtn');
    if(saveBtn){
      saveBtn.addEventListener('click', function(){
        if(state.saving) return;
        if(!state.pendingCharacterKey){ toast('Get your mission first!'); return; }
        // RTDB fires the local "guests" listener (-> render()) the moment set() is called, before the
        // server confirms. Keeping the guard in state means that re-render still shows a disabled button.
        state.saving = true;
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        if(!state.pendingGuestId) state.pendingGuestId = uid();
        var id = state.pendingGuestId;
        var info = CHARACTER_INFO[state.pendingCharacterKey];
        var record = {
          name: state.guestNameInput.trim(),
          team: info.team,
          characterKey: state.pendingCharacterKey,
          photo: state.pendingPhoto || null,
          ts: Date.now()
        };
        db.ref('guests/'+id).set(record).then(function(){
          localSet('djed-my-guest-id', id);
          state.myGuestId = id;
          state.saving = false;
          state.pendingGuestId = null;
          toast('Welcome to the mission, '+record.name+'!');
          render();
        }).catch(function(){
          // keep pendingGuestId: a retry writes to the same key, so it can't create a second record
          state.saving = false;
          toast('Could not save — check your connection and try again.');
          render();
        });
      });
    }
  }

  // ---------------- SPIN TAB ----------------
  var wheelRotation = 0;
  function renderSpin(){
    var names = state.guests.map(function(g){ return g.name; });
    var canSpin = names.length > 0 && !state.spinning;

    screen.innerHTML =
      '<div class="panel">'+
        '<span class="eyebrow">Random Co-Leader</span>'+
        '<h2>Who Helps Djed Lead?</h2>'+
        '<p>Pick which stop, then spin. Djed and the winner help lead the way together.</p>'+
        '<label class="field-label">Stop</label>'+
        '<select id="gameSelect">'+
          STOPS.map(function(s){ return '<option value="'+esc(s)+'" '+(state.coLeaderGame===s?'selected':'')+'>'+esc(s)+'</option>'; }).join('')+
        '</select>'+
        '<div class="wheel-wrap">'+
          '<div class="wheel-pointer"></div>'+
          '<div class="wheel" id="wheel" style="transform:rotate('+wheelRotation+'deg)">'+
            '<div class="wheel-center">GO</div>'+
          '</div>'+
        '</div>'+
        '<button class="btn gold" id="spinBtn" '+(canSpin?'':'disabled')+' style="margin-top:16px;">'+
          (names.length===0 ? 'No guests checked in yet' : (state.spinning ? 'Spinning...' : '🎯 Spin the Wheel'))+
        '</button>'+
        (state.coLeader ? '<div class="co-leader-result">Co-leader for '+esc(state.coLeaderGame)+':<br><span class="who">'+esc(state.coLeader)+'</span></div>' : '')+
      '</div>';

    var gameSelect = document.getElementById('gameSelect');
    if(gameSelect){
      gameSelect.addEventListener('change', function(e){ state.coLeaderGame = e.target.value; });
    }

    var spinBtn = document.getElementById('spinBtn');
    if(spinBtn && canSpin){
      spinBtn.addEventListener('click', function(){
        if(names.length === 0) return;
        state.spinning = true;
        render();
        var winner = names[Math.floor(Math.random()*names.length)];
        var wheelEl = document.getElementById('wheel');
        var extraSpins = 4 + Math.floor(Math.random()*3);
        wheelRotation += extraSpins*360 + Math.floor(Math.random()*360);
        wheelEl.style.transform = 'rotate('+wheelRotation+'deg)';
        setTimeout(function(){
          state.spinning = false;
          state.coLeader = winner;
          db.ref('coLeader').set({name:winner, game:state.coLeaderGame, ts:Date.now()});
          toast(winner + ' is co-leader!');
          render();
        }, 3300);
      });
    }
  }

  // ---------------- CAPSULE TAB ----------------
  function renderCapsule(){
    var heroCount = state.guests.filter(function(g){ return g.team==='hero'; }).length;
    var villainCount = state.guests.filter(function(g){ return g.team==='villain'; }).length;

    var gridHtml;
    if(state.guests.length === 0){
      gridHtml = '<div class="empty-state">No one\'s checked in yet.<br>Be the first — head to Suit Up!</div>';
    } else {
      gridHtml = '<div class="guest-grid">' + state.guests.map(function(g){
        var info = CHARACTER_INFO[g.characterKey] || {name:g.characterKey, emoji:'🕷️'};
        var teamLabel = g.team === 'hero' ? 'HERO' : 'VILLAIN';
        var dupLabel = duplicateLabel(g);
        var img = g.photo ? '<img src="'+g.photo+'" alt="'+esc(g.name)+'">' : '<div class="noimg">'+ info.emoji +'</div>';
        return '<div class="guest-card">'+img+
          '<div class="info"><div class="gname">'+esc(g.name)+'</div>'+
          '<div class="gchar">'+ info.emoji +' '+esc(info.name)+esc(dupLabel)+' · '+teamLabel+'</div></div></div>';
      }).join('') + '</div>';
    }

    screen.innerHTML =
      '<div class="panel">'+
        '<span class="eyebrow">Memory Capsule</span>'+
        '<h2>The Whole Squad</h2>'+
        '<div class="stat-row">'+
          '<div class="stat-box"><div class="num">'+state.guests.length+'</div><div class="lbl">Checked In</div></div>'+
          '<div class="stat-box"><div class="num">'+heroCount+'</div><div class="lbl">Heroes</div></div>'+
          '<div class="stat-box"><div class="num">'+villainCount+'</div><div class="lbl">Villains</div></div>'+
        '</div>'+
        gridHtml+
      '</div>'+
      '<div class="panel">'+
        '<span class="eyebrow">All The Photos</span>'+
        '<h2>Full Album</h2>'+
        '<p>Guests: upload your phone photos from the day to the shared album so everyone can relive it.</p>'+
        (state.settings.driveLink ?
          '<a class="drivelink" href="'+esc(state.settings.driveLink)+'" target="_blank" rel="noopener">📁 View &amp; Upload Photos →</a>' :
          '<p style="opacity:0.6; font-size:13px;">Drive link not added yet — the host can add it in ⚙️ settings.</p>')+
      '</div>';
  }

  // ---------------- ADMIN LOGIN ----------------
  function renderAdminLogin(){
    screen.innerHTML =
      '<div class="panel">'+
        '<div class="admin-login-stage">'+
          '<div class="lock">🔐</div>'+
          '<h2>Admin Only</h2>'+
          '<input type="password" id="adminPw" placeholder="Admin password" value="">'+
          (state.adminLoginError ? '<p style="color:var(--comic-red-dark); font-size:13px;">'+esc(state.adminLoginError)+'</p>' : '')+
          '<button class="btn blue" id="adminLoginBtn">Unlock</button>'+
          '<p class="admin-caveat">This keeps casual guests out of settings. It is not real security — anyone who inspects network traffic could bypass it. Fine for a private family party, not for anything sensitive.</p>'+
        '</div>'+
      '</div>'+
      '<button class="btn ghost" id="backBtn">← Back</button>';

    document.getElementById('backBtn').addEventListener('click', function(){ setTab('invite'); });

    function attemptLogin(){
      var pw = document.getElementById('adminPw').value;
      db.ref('adminAuth/password').once('value').then(function(snap){
        var real = snap.val() || DEFAULT_ADMIN_PASSWORD;
        if(pw === real){
          state.adminAuthed = true;
          sessionSet('djed-admin-authed', '1');
          state.adminLoginError = '';
          setTab('admin');
        } else {
          state.adminLoginError = 'Incorrect password.';
          render();
        }
      });
    }

    document.getElementById('adminLoginBtn').addEventListener('click', attemptLogin);
    document.getElementById('adminPw').addEventListener('keydown', function(e){
      if(e.key === 'Enter') attemptLogin();
    });
  }

  // ---------------- ADMIN PANEL ----------------
  function renderAdmin(){
    var totalHeadcount = state.rsvps.reduce(function(sum, r){ return sum + (Number(r.headcount) || 0); }, 0);
    var rsvpRows = state.rsvps.map(function(r){
      return '<tr><td>'+esc(r.name)+'</td><td>'+esc(r.headcount)+'</td><td>'+esc(new Date(r.ts).toLocaleString())+'</td></tr>';
    }).join('');

    screen.innerHTML =
      '<div class="panel">'+
        '<span class="eyebrow">Host Only</span>'+
        '<h2>Edit Event Details</h2>'+
        '<label class="field-label">Venue name</label>'+
        '<input type="text" id="s_venueName" value="'+esc(state.settings.venueName)+'">'+
        '<label class="field-label">Venue address</label>'+
        '<input type="text" id="s_venueAddress" value="'+esc(state.settings.venueAddress)+'">'+
        '<label class="field-label">Event date</label>'+
        '<input type="text" id="s_eventDate" value="'+esc(state.settings.eventDate)+'">'+
        '<label class="field-label">Event time</label>'+
        '<input type="text" id="s_eventTime" value="'+esc(state.settings.eventTime)+'">'+
        '<label class="field-label">Entry fee note</label>'+
        '<input type="text" id="s_entryFee" value="'+esc(state.settings.entryFeeNote)+'">'+
        '<label class="field-label">RSVP / dress-up note</label>'+
        '<input type="text" id="s_note" value="'+esc(state.settings.rsvpNote)+'">'+
        '<label class="field-label">Shared Google Drive photo album link</label>'+
        '<input type="url" id="s_drive" placeholder="https://drive.google.com/..." value="'+esc(state.settings.driveLink)+'">'+
        '<label class="field-label">RSVP deadline</label>'+
        '<input type="date" id="s_deadline" value="'+esc(state.settings.rsvpDeadline)+'">'+
        '<div class="checkbox-row"><input type="checkbox" id="s_reopen" '+(state.settings.rsvpReopened?'checked':'')+'><label for="s_reopen">Reopen RSVPs (override deadline)</label></div>'+
        '<button class="btn blue" id="saveSettings">💾 Save For Everyone</button>'+
      '</div>'+

      '<div class="panel">'+
        '<span class="eyebrow">RSVPs</span>'+
        '<h2>Who\'s Coming</h2>'+
        '<p style="font-size:13px;">Total headcount: <strong>'+totalHeadcount+'</strong> across '+state.rsvps.length+' RSVP'+(state.rsvps.length===1?'':'s')+'</p>'+
        (state.rsvps.length ? ('<div style="overflow-x:auto;"><table class="rsvp-table"><thead><tr><th>Name</th><th>Count</th><th>When</th></tr></thead><tbody>'+rsvpRows+'</tbody></table></div>') : '<p style="opacity:0.6; font-size:13px;">No RSVPs yet.</p>')+
        '<button class="btn danger small" id="resetRsvps">Reset RSVPs</button>'+
      '</div>'+

      '<div class="panel">'+
        '<span class="eyebrow">Guest Check-Ins</span>'+
        '<h2>'+state.guests.length+' Checked In</h2>'+
        '<p style="font-size:13px;">Use this before the real party to clear test check-ins. This also resets the character assignment queue.</p>'+
        '<button class="btn danger small" id="resetGuests">Reset Guest Check-Ins</button>'+
      '</div>'+

      '<div class="panel">'+
        '<span class="eyebrow">Security</span>'+
        '<h2>Change Admin Password</h2>'+
        '<label class="field-label">Current password</label>'+
        '<input type="password" id="pw_current">'+
        '<label class="field-label">New password</label>'+
        '<input type="password" id="pw_new">'+
        '<button class="btn small" id="changePw">Change Password</button>'+
      '</div>'+

      '<button class="btn ghost" id="logoutBtn">Log Out of Admin</button>'+
      '<div style="height:10px;"></div>'+
      '<button class="btn ghost" id="backBtn">← Back to Invite</button>';

    document.getElementById('backBtn').addEventListener('click', function(){ setTab('invite'); });
    document.getElementById('logoutBtn').addEventListener('click', function(){
      state.adminAuthed = false;
      try{ window.sessionStorage.removeItem('djed-admin-authed'); }catch(e){}
      setTab('invite');
    });

    document.getElementById('saveSettings').addEventListener('click', function(){
      var newSettings = {
        venueName: document.getElementById('s_venueName').value.trim() || DEFAULT_SETTINGS.venueName,
        venueAddress: document.getElementById('s_venueAddress').value.trim() || DEFAULT_SETTINGS.venueAddress,
        eventDate: document.getElementById('s_eventDate').value.trim() || DEFAULT_SETTINGS.eventDate,
        eventTime: document.getElementById('s_eventTime').value.trim() || DEFAULT_SETTINGS.eventTime,
        entryFeeNote: document.getElementById('s_entryFee').value.trim(),
        rsvpNote: document.getElementById('s_note').value.trim(),
        driveLink: document.getElementById('s_drive').value.trim(),
        rsvpDeadline: document.getElementById('s_deadline').value || DEFAULT_SETTINGS.rsvpDeadline,
        rsvpReopened: document.getElementById('s_reopen').checked
      };
      db.ref('settings').set(newSettings).then(function(){
        state.settings = newSettings;
        toast('Saved for everyone!');
        render();
      }).catch(function(){ toast('Could not save, try again.'); });
    });

    document.getElementById('resetRsvps').addEventListener('click', function(){
      if(!window.confirm('Clear all RSVPs? This cannot be undone.')) return;
      db.ref('rsvps').remove().then(function(){ toast('RSVPs cleared.'); });
    });

    document.getElementById('resetGuests').addEventListener('click', function(){
      if(!window.confirm('Clear all guest check-ins and reset the character queue? This cannot be undone.')) return;
      Promise.all([
        db.ref('guests').remove(),
        db.ref('characterQueue').remove(),
        db.ref('characterQueueIndex').remove()
      ]).then(function(){
        localSet('djed-my-guest-id', '');
        state.myGuestId = null;
        toast('Guest check-ins cleared.');
      });
    });

    document.getElementById('changePw').addEventListener('click', function(){
      var current = document.getElementById('pw_current').value;
      var next = document.getElementById('pw_new').value;
      if(!next){ toast('Enter a new password.'); return; }
      db.ref('adminAuth/password').once('value').then(function(snap){
        var real = snap.val() || DEFAULT_ADMIN_PASSWORD;
        if(current !== real){ toast('Current password is incorrect.'); return; }
        return db.ref('adminAuth/password').set(next).then(function(){ toast('Password changed.'); });
      });
    });
  }

  // ---------------- render dispatcher ----------------
  function render(){
    if(state.tab === 'invite') renderInvite();
    else if(state.tab === 'rsvp') renderRsvp();
    else if(state.tab === 'suitup') renderSuitUp();
    else if(state.tab === 'spin') renderSpin();
    else if(state.tab === 'capsule') renderCapsule();
    else if(state.tab === 'adminlogin') renderAdminLogin();
    else if(state.tab === 'admin') renderAdmin();
  }

  // ---------------- boot ----------------
  function boot(){
    screen.innerHTML = '<div class="empty-state">Loading mission data...</div>';
    Promise.all([loadSettings(), ensureDefaultAdminPassword()])
      .then(function(){
        attachListeners();
        render();
      })
      .catch(function(err){
        console.error(err);
        screen.innerHTML = '<div class="empty-state">Could not load party data. Check your Firebase config in firebase-config.js, then reload.</div>';
      });
  }

  boot();
})();
