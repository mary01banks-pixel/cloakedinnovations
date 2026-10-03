/* Cloaked Innovations Limited - shared behaviour for every page
   (menu, FAQ accordion, product filter, enquiry form, testimonials, live chat, analytics) */
(function(){
  // ============================================================
  // SUPABASE CONFIG — fill in your project's values here.
  // Find these in Supabase: Settings → API
  // The anon key is safe to expose in client-side code; Row Level
  // Security (set up via supabase-schema.sql) controls what it can do.
  // ============================================================
  var SUPABASE_URL = "https://swguesxklmbfwanxzjjt.supabase.co"; // e.g. https://xxxxx.supabase.co
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3Z3Vlc3hrbG1iZndhbnh6amp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5MzQ3OTIsImV4cCI6MjEwNTUxMDc5Mn0.N6636rHeofqQl_sNylzVgIKrno5jpWQmrNwS3OHh488";

  var supa = null;
  if (SUPABASE_URL.indexOf("YOUR_SUPABASE") === -1 && window.supabase) {
    supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  var menuToggle = document.getElementById('menuToggle');
  var primaryNav = document.getElementById('primaryNav');

  // ---------- Session ID (used for analytics + chat, no personal data) ----------
  function getSessionId(){
    try{
      var sid = window.localStorage.getItem('cloaked-session-id');
      if(!sid){
        sid = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
        window.localStorage.setItem('cloaked-session-id', sid);
      }
      return sid;
    }catch(e){
      return 'no-storage-' + Math.random().toString(16).slice(2);
    }
  }
  var sessionId = getSessionId();

  // ---------- Analytics: basic pageview counter ----------
  function trackPageView(pageId){
    if(!supa) return;
    supa.from('page_views').insert({
      page: pageId,
      session_id: sessionId,
      referrer: document.referrer || null
    }).then(function(){}, function(){});
  }

  function closeMenu(){
    primaryNav.classList.remove('open');
    menuToggle.setAttribute('aria-expanded','false');
  }

  menuToggle.addEventListener('click', function(){
    var open = primaryNav.classList.toggle('open');
    menuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  var navDropdown = document.querySelector('.nav-dropdown');
  var navCaret = navDropdown ? navDropdown.querySelector('.caret') : null;
  if(navCaret){
    navCaret.addEventListener('click', function(e){
      if(window.innerWidth <= 900){
        e.preventDefault();
        e.stopPropagation();
        navDropdown.classList.toggle('open');
      }
    });
  }

  // Count this page view (the page id comes from <body data-page="...">)
  trackPageView(document.body.getAttribute('data-page') || 'home');

  // FAQ accordion
  document.querySelectorAll('.faq-item').forEach(function(item){
    var btn = item.querySelector('.faq-q');
    btn.addEventListener('click', function(){
      var isOpen = item.classList.contains('open');
      item.classList.toggle('open', !isOpen);
      btn.setAttribute('aria-expanded', !isOpen ? 'true' : 'false');
    });
  });

  // Product search & filter
  var searchInput = document.getElementById('productSearch');
  var chips = document.querySelectorAll('.chip');
  var cards = document.querySelectorAll('#productGrid .cat-card');
  var noResults = document.getElementById('noResults');
  var activeFilter = 'all';

  function applyFilter(){
    var term = (searchInput ? searchInput.value : '').toLowerCase().trim();
    var visibleCount = 0;
    cards.forEach(function(card){
      var cat = card.getAttribute('data-cat');
      var text = card.textContent.toLowerCase();
      var matchesFilter = activeFilter === 'all' || cat === activeFilter;
      var matchesSearch = term === '' || text.indexOf(term) !== -1;
      var show = matchesFilter && matchesSearch;
      card.style.display = show ? '' : 'none';
      if(show) visibleCount++;
    });
    if(noResults) noResults.style.display = visibleCount === 0 ? 'block' : 'none';
  }

  if(searchInput) searchInput.addEventListener('input', applyFilter);
  chips.forEach(function(chip){
    chip.addEventListener('click', function(){
      chips.forEach(function(c){ c.classList.remove('active'); });
      chip.classList.add('active');
      activeFilter = chip.getAttribute('data-filter');
      applyFilter();
    });
  });

  // Contact form -> saved to the admin panel (no email client is opened)
  var form = document.getElementById('enquiryForm');
  var successBox = document.getElementById('formSuccess');
  var errorBox = document.getElementById('formError');
  var errorBoxOriginal = errorBox ? errorBox.innerHTML : '';
  var formLoadedAt = Date.now();
  var ENQUIRY_COOLDOWN_MS = 60 * 1000;   // one enquiry per minute per browser
  var ENQUIRY_MIN_FILL_MS = 4000;        // a person cannot complete the form faster than this

  function countLinks(text){ return (String(text).match(/https?:\/\/|www\./gi) || []).length; }
  function showFormNotice(msg){
    if(!errorBox) return;
    errorBox.textContent = msg;
    errorBox.classList.add('show');
    errorBox.scrollIntoView({behavior:'smooth', block:'center'});
  }

  if(form){
    // Sensible length limits on every field
    var limits = {fullName:120, orgName:160, email:254, phone:40, productNeeded:200, quantity:200, message:4000};
    Object.keys(limits).forEach(function(id){
      var el = document.getElementById(id);
      if(el) el.setAttribute('maxlength', limits[id]);
    });

    form.addEventListener('submit', function(e){
      e.preventDefault();
      if(errorBox){ errorBox.innerHTML = errorBoxOriginal; errorBox.classList.remove('show'); }

      // 1. Honeypot: real visitors never see or fill this field. Bots do.
      var hp = document.getElementById('hpCheck');
      if(hp && hp.value){
        form.reset();
        if(successBox) successBox.classList.add('show');   // look successful, send nothing
        return;
      }
      // 2. Too fast to be a person
      if(Date.now() - formLoadedAt < ENQUIRY_MIN_FILL_MS){
        showFormNotice('Please take a moment to check your details, then send your enquiry again.');
        return;
      }
      // 3. Cooldown between enquiries
      try{
        var last = parseInt(window.localStorage.getItem('cloaked-last-enquiry') || '0', 10);
        if(last && Date.now() - last < ENQUIRY_COOLDOWN_MS){
          showFormNotice('Your enquiry was just sent. Please wait a minute before sending another, or call us on 0796 968 241.');
          return;
        }
      }catch(err){}
      // 4. Too many links in the message
      if(countLinks(document.getElementById('message').value) > 2){
        showFormNotice('Your message has several links. Please remove them or email us directly.');
        return;
      }
      var submitBtn = form.querySelector('button[type="submit"]');
      var name = document.getElementById('fullName').value.trim();
      var org = document.getElementById('orgName').value.trim();
      var email = document.getElementById('email').value.trim();
      var phone = document.getElementById('phone').value.trim();
      var subjectField = document.getElementById('subject').value;
      var product = document.getElementById('productNeeded').value.trim();
      var qty = document.getElementById('quantity').value.trim();
      var message = document.getElementById('message').value.trim();

      // Contact details are also stored with the enquiry itself, so the admin
      // always sees who sent it and how to reply.
      var fullMessage = [
        'Name: ' + name,
        'Organisation: ' + (org || '-'),
        'Email: ' + email,
        'Phone: ' + (phone || '-'),
        '',
        message
      ].join('\n');

      successBox.classList.remove('show');
      errorBox.classList.remove('show');
      if(!supa){ errorBox.classList.add('show'); return; }

      var originalLabel = submitBtn ? submitBtn.textContent : '';
      if(submitBtn){ submitBtn.disabled = true; submitBtn.textContent = 'Sending\u2026'; }

      function saveCustomer(){
        var row = { full_name: name, organisation: org, email: email, phone: phone };
        return supa.from('customers').insert(row).select().then(function(res){
          if(!res.error && res.data && res.data[0]) return res.data[0].id;
          // Retry without reading the row back (some setups don't allow it)
          return supa.from('customers').insert(row).then(function(){ return null; });
        });
      }

      saveCustomer().catch(function(){ return null; }).then(function(customerId){
        return supa.from('orders').insert({
          customer_id: customerId,
          subject: subjectField,
          product_needed: product,
          quantity: qty,
          message: fullMessage,
          status: 'new'
        });
      }).then(function(res){
        if(res.error) throw res.error;
        form.reset();
        formLoadedAt = Date.now();
        try{ window.localStorage.setItem('cloaked-last-enquiry', String(Date.now())); }catch(err){}
        successBox.classList.add('show');
        successBox.scrollIntoView({behavior:'smooth', block:'center'});
      }).catch(function(){
        errorBox.classList.add('show');
        errorBox.scrollIntoView({behavior:'smooth', block:'center'});
      }).then(function(){
        if(submitBtn){ submitBtn.disabled = false; submitBtn.textContent = originalLabel; }
      });
    });
  }

  var yearEl = document.getElementById('year');
  if(yearEl) yearEl.textContent = new Date().getFullYear();

  // Scroll-to-top floating button
  var scrollTopBtn = document.getElementById('scrollTopBtn');
  if(scrollTopBtn){
    window.addEventListener('scroll', function(){
      scrollTopBtn.style.display = window.scrollY > 400 ? 'flex' : 'none';
    });
    scrollTopBtn.addEventListener('click', function(){
      window.scrollTo({top:0, behavior:'smooth'});
    });
  }

  // ---------- Testimonials: load approved ones from Supabase ----------
  function loadTestimonials(){
    if(!supa || !document.getElementById('testimonialsGrid')) return;
    supa.from('testimonials').select('*').eq('approved', true).order('created_at', {ascending:false}).limit(9)
      .then(function(res){
        var rows = res.data || [];
        if(rows.length === 0) return;
        var grid = document.getElementById('testimonialsGrid');
        var section = document.getElementById('testimonialsSection');
        grid.innerHTML = rows.map(function(t){
          var name = (t.customer_name || '').replace(/</g,'&lt;');
          var org = (t.organisation || '').replace(/</g,'&lt;');
          var quote = (t.quote || '').replace(/</g,'&lt;');
          return '<div class="testimonial-card"><span class="quote-mark" aria-hidden="true">&ldquo;</span>' +
            '<p>' + quote + '</p>' +
            '<div class="who">' + name + (org ? '<span>' + org + '</span>' : '') + '</div></div>';
        }).join('');
        section.style.display = 'block';
      }, function(){});
  }
  loadTestimonials();

  // ---------- Chat widget ----------
  function initChatWidget(){
    if(!supa) return;
    var conversationId = null;

    try{ conversationId = window.localStorage.getItem('cloaked-chat-conv-id'); }catch(e){}

    var toggle = document.getElementById('chatToggle');
    var panel = document.getElementById('chatPanel');
    var closeBtn = document.getElementById('chatClose');
    var messagesEl = document.getElementById('chatMessages');
    var formEl = document.getElementById('chatForm');
    var inputEl = document.getElementById('chatInput');
    var preForm = document.getElementById('chatPreForm');
    var nameInput = document.getElementById('chatName');
    var emailInput = document.getElementById('chatEmail');
    var startBtn = document.getElementById('chatStart');
    if(!toggle || !panel) return;

    var CHAT_MIN_GAP_MS = 2000;     // at least 2 seconds between messages
    var CHAT_MAX_MESSAGES = 40;     // per page visit
    var CHAT_START_COOLDOWN_MS = 30 * 1000;
    var lastChatSent = 0;
    var chatSentCount = 0;
    if(nameInput) nameInput.setAttribute('maxlength', 80);
    if(emailInput) emailInput.setAttribute('maxlength', 254);
    if(inputEl) inputEl.setAttribute('maxlength', 1000);
    function chatLinks(text){ return (String(text).match(/https?:\/\/|www\./gi) || []).length; }

    function open(){ panel.classList.add('open'); toggle.setAttribute('aria-expanded','true'); }
    function close(){ panel.classList.remove('open'); toggle.setAttribute('aria-expanded','false'); }
    toggle.addEventListener('click', function(){
      panel.classList.contains('open') ? close() : open();
      if(conversationId) loadMessages();
    });
    closeBtn.addEventListener('click', close);

    function renderMessage(m){
      var div = document.createElement('div');
      div.className = 'chat-msg ' + (m.sender === 'admin' ? 'chat-msg-admin' : 'chat-msg-visitor');
      div.textContent = m.message;
      messagesEl.appendChild(div);
    }

    function loadMessages(){
      if(!conversationId) return;
      supa.from('chat_messages').select('*').eq('conversation_id', conversationId).order('created_at', {ascending:true})
        .then(function(res){
          messagesEl.innerHTML = '';
          (res.data || []).forEach(renderMessage);
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }, function(){});
    }

    function subscribeToReplies(){
      if(!conversationId) return;
      supa.channel('chat-' + conversationId)
        .on('postgres_changes', {event:'INSERT', schema:'public', table:'chat_messages', filter:'conversation_id=eq.' + conversationId}, function(payload){
          if(payload.new.sender === 'admin'){
            renderMessage(payload.new);
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
        })
        .subscribe();
    }

    function startConversation(name, email){
      supa.from('chat_conversations').insert({
        visitor_name: name, visitor_email: email, session_id: sessionId
      }).select().then(function(res){
        if(res.data && res.data[0]){
          conversationId = res.data[0].id;
          try{ window.localStorage.setItem('cloaked-chat-conv-id', conversationId); }catch(e){}
          preForm.style.display = 'none';
          formEl.style.display = 'flex';
          messagesEl.style.display = 'block';
          renderMessage({sender:'admin', message:'Thanks for reaching out! Send us a message and our team will reply here as soon as possible.'});
          subscribeToReplies();
        }
      }, function(){});
    }

    if(startBtn){
      startBtn.addEventListener('click', function(){
        var name = nameInput.value.trim().slice(0, 80);
        if(!name) { nameInput.focus(); return; }
        try{
          var lastStart = parseInt(window.localStorage.getItem('cloaked-last-chat-start') || '0', 10);
          if(lastStart && Date.now() - lastStart < CHAT_START_COOLDOWN_MS) return;
          window.localStorage.setItem('cloaked-last-chat-start', String(Date.now()));
        }catch(err){}
        startConversation(name, emailInput.value.trim().slice(0, 254));
      });
    }

    if(formEl){
      formEl.addEventListener('submit', function(e){
        e.preventDefault();
        var text = inputEl.value.trim().slice(0, 1000);
        if(!text || !conversationId) return;
        if(Date.now() - lastChatSent < CHAT_MIN_GAP_MS) return;
        if(chatLinks(text) > 2) return;
        if(chatSentCount >= CHAT_MAX_MESSAGES){
          renderMessage({sender:'admin', message:'You have reached the message limit for this visit. Please email info@cloakedinnovations.co.ke or call 0796 968 241.'});
          return;
        }
        lastChatSent = Date.now();
        chatSentCount++;
        supa.from('chat_messages').insert({
          conversation_id: conversationId, sender: 'visitor', message: text
        }).then(function(){
          renderMessage({sender:'visitor', message:text});
          messagesEl.scrollTop = messagesEl.scrollHeight;
          inputEl.value = '';
        }, function(){});
      });
    }

    // Resume an existing conversation if the visitor already started one
    if(conversationId){
      preForm.style.display = 'none';
      formEl.style.display = 'flex';
      messagesEl.style.display = 'block';
      loadMessages();
      subscribeToReplies();
    }
  }
  initChatWidget();
})();
