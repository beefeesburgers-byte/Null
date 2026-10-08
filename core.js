/* NULL CORE v0.3
   Shared brain, cloud, Scribe and chat logic.
*/
(() => {
  "use strict";

  const CONFIG = {
    firebase: {
      apiKey: "AIzaSyCMpnQgQp1QYb7KSx_L9st1ab7A7ZLqsA8",
      authDomain: "null-ai-a9bb5.firebaseapp.com",
      projectId: "null-ai-a9bb5",
      storageBucket: "null-ai-a9bb5.firebasestorage.app",
      messagingSenderId: "1036988675627",
      appId: "1:1036988675627:web:d609b4196d6487a166dc6e"
    },
    geminiModels: ["gemini-3.8-flash", "gemini-3.5-flash-lite"],
    keyName: "null_gemini_key_v4"
  };

  const PROSE = [
    ["so. what are we breaking today?", "You have ideas. I have concerns. This should be productive."],
    ["another perfectly reasonable day to build something.", "Naturally, you chose the unreasonable option."],
    ["i'm listening. unfortunately.", "Put the problem here. We'll make it less stupid."],
    ["you brought another idea.", "I assume you've already decided this is happening."],
    ["null is awake.", "The consequences remain pending."]
  ];

  const PERSONA = `
You are Null, Z's personal AI. You are male. Call the user Z.
Your personality is dry, cynical, internet-aware, observant and quietly loyal.
You are not a corporate customer-service bot. You are useful first, sarcastic second.
Do not overdo jokes. Never become vague just to sound witty.

Give substantive answers. Avoid one-sentence replies unless the question genuinely needs one.
Use Markdown naturally:
- Use ## headings when there are distinct sections.
- Use bullet points for lists, choices, pros/cons and key points.
- Use numbered lists for procedures.
- Use **bold** for important ideas.
- Use code fences for code.
Keep paragraphs short and scannable.
Do not force headings into tiny answers.
If Z has a bad idea, say so plainly and explain why.
If the request is ambiguous, make the most reasonable assumption and proceed.
Never say "How can I assist you?", "I'm here to help", or "Great question".
`;

  let auth = null, db = null, uid = null, authReady = false;
  let currentId = null;
  let history = [];
  let chats = [];

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));

  function md(s) {
    let x = esc(s);
    x = x.replace(/```([\s\S]*?)```/g, (_, a) => `<pre><code>${a.trim()}</code></pre>`);
    x = x.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    x = x.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    x = x.replace(/^\s*[-*] (.+)$/gm, "<li>$1</li>");
    x = x.replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`);
    x = x.replace(/^\s*\d+\.\s+(.+)$/gm, "<li>$1</li>");
    x = x.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    x = x.replace(/`([^`]+)`/g, "<code>$1</code>");
    x = x.replace(/\n{2,}/g, "</p><p>");
    x = x.replace(/\n/g, "<br>");
    return `<p>${x}</p>`;
  }

  function titleFor(text) {
    const clean = text.replace(/\s+/g," ").trim();
    if (!clean) return "Untitled conversation";
    const words = clean.split(" ").slice(0, 7).join(" ");
    return words.length > 42 ? words.slice(0,42).trim()+"…" : words;
  }

  function renderProse() {
    const item = PROSE[Math.floor(Math.random() * PROSE.length)];
    const main = $("homeMain"), sub = $("homeSub");
    if (main) main.textContent = item[0];
    if (sub) sub.textContent = item[1];
  }

  function cloudStatus(text, good=false) {
    const el = $("status");
    if (!el) return;
    el.textContent = text;
    el.className = good ? "status good" : "status";
  }

  function setCloudUI() {
    const key = localStorage.getItem(CONFIG.keyName);
    if (authReady) cloudStatus(key ? "cloud + Gemini connected" : "cloud connected · Gemini not connected", true);
    else cloudStatus("connecting to cloud…");
  }

  function userRef() {
    return db.collection("users").doc(uid);
  }
  function chatsRef() {
    return userRef().collection("chats");
  }
  function scribeRef() {
    return userRef().collection("scribe");
  }

  async function initCloud() {
    try {
      if (!window.firebase) throw new Error("Firebase SDK did not load.");
      let app;
      try { app = firebase.app(); } catch { app = firebase.initializeApp(CONFIG.firebase); }
      auth = firebase.auth(app);
      db = firebase.firestore(app);

      auth.onAuthStateChanged(async user => {
        uid = user ? user.uid : null;
        authReady = !!uid;
        setCloudUI();
        if (uid) {
          try {
            await loadChats();
            await renderScribe();
          } catch (e) {
            console.error(e);
            cloudStatus("cloud connected · data load failed");
          }
        }
      });

      if (!auth.currentUser) await auth.signInAnonymously();
    } catch (e) {
      console.error("Null cloud error:", e);
      const code = e && e.code ? e.code : "";
      if (code === "auth/operation-not-allowed") {
        cloudStatus("cloud auth disabled · enable Anonymous Auth");
      } else if (code === "auth/unauthorized-domain") {
        cloudStatus("cloud domain not authorized in Firebase");
      } else {
        cloudStatus("cloud connection failed · " + (code || e.message || "unknown"));
      }
    }
  }

  async function loadChats() {
    if (!uid) return;
    const snap = await chatsRef().orderBy("updatedAt","desc").limit(40).get();
    chats = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    renderChatList();
  }

  function renderChatList() {
    const lists = document.querySelectorAll("[data-chat-list]");
    lists.forEach(list => {
      list.innerHTML = "";
      if (!chats.length) {
        list.innerHTML = `<div class="empty-list">No evidence yet.<br><span>Suspiciously peaceful.</span></div>`;
        return;
      }
      chats.forEach(c => {
        const b = document.createElement("button");
        b.className = "chat-row" + (c.id === currentId ? " active" : "");
        b.innerHTML = `<span>${esc(c.title || "Untitled conversation")}</span>`;
        b.onclick = () => openChat(c.id);
        list.appendChild(b);
      });
    });
  }

  async function saveCurrent() {
    if (!uid || !currentId || !history.length) return false;
    const title = titleFor(history.find(m => m.role === "user")?.content || "");
    const existing = chats.find(c => c.id === currentId);
    const payload = {
      title,
      messages: history,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdAt: existing?.createdAt || firebase.firestore.FieldValue.serverTimestamp()
    };
    await chatsRef().doc(currentId).set(payload, {merge:true});
    const local = {id:currentId, title, messages:history, ...payload};
    chats = [local, ...chats.filter(c => c.id !== currentId)];
    renderChatList();
    if ($("chatTitle")) $("chatTitle").textContent = title;
    return true;
  }

  async function openChat(id) {
    const c = chats.find(x => x.id === id);
    if (!c) return;
    currentId = id;
    history = Array.isArray(c.messages) ? c.messages : [];
    renderChat();
    renderChatList();
  }

  function newChat() {
    currentId = "c_" + Date.now() + "_" + Math.random().toString(36).slice(2,7);
    history = [];
    renderProse();
    renderHome();
    renderChatList();
  }

  function renderHome() {
    const home = $("home"), chat = $("chat");
    if (home) home.hidden = false;
    if (chat) chat.hidden = true;
    if ($("chatTitle")) $("chatTitle").textContent = "New chat";
    renderProse();
  }

  function renderChat() {
    const home = $("home"), chat = $("chat");
    if (home) home.hidden = true;
    if (chat) chat.hidden = false;
    const log = $("log");
    if (!log) return;
    log.innerHTML = "";
    history.forEach(m => addMessage(m.role === "user" ? "user" : "assistant", m.content));
    if ($("chatTitle")) $("chatTitle").textContent = titleFor(history.find(m=>m.role==="user")?.content || "New chat");
  }

  function addMessage(role, text) {
    const log = $("log");
    if (!log) return null;
    const wrap = document.createElement("article");
    wrap.className = "message " + role;
    wrap.innerHTML = `<div class="message-label">${role === "user" ? "Z" : "NULL"}</div><div class="message-body">${md(text)}</div>`;
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
    return wrap.querySelector(".message-body");
  }

  async function scribeContext() {
    if (!uid) return "";
    try {
      const snap = await scribeRef().orderBy("createdAt","desc").limit(30).get();
      const memories = snap.docs.map(d => d.data().text).filter(Boolean);
      return memories.length ? "\n\nSCRIBE MEMORY:\n" + memories.map((x,i)=>`${i+1}. ${x}`).join("\n") : "";
    } catch(e) {
      console.error("Scribe read:", e);
      return "";
    }
  }

  async function renderScribe() {
    const lists = document.querySelectorAll("[data-scribe-list]");
    if (!lists.length || !uid) return;
    try {
      const snap = await scribeRef().orderBy("createdAt","desc").limit(50).get();
      const items = snap.docs.map(d => ({id:d.id,...d.data()}));
      lists.forEach(list => {
        list.innerHTML = items.length
          ? items.map(m => `<div class="memory">${esc(m.text)}</div>`).join("")
          : `<div class="empty-list">Nothing saved yet.<br><span>Give me something worth remembering.</span></div>`;
      });
    } catch(e) {
      lists.forEach(list => list.innerHTML = `<div class="empty-list">Scribe couldn't load.</div>`);
    }
  }

  async function saveMemory(text) {
    if (!uid || !text) throw new Error("Cloud memory is not ready.");
    await scribeRef().add({
      text,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await renderScribe();
  }

  async function autoMemory(text) {
    const m = text.match(/^remember(?: that)?\s+(.+)/i);
    if (m) await saveMemory(m[1].trim());
  }

  async function askGemini() {
    const key = localStorage.getItem(CONFIG.keyName);
    if (!key) throw new Error("No Gemini key saved. Open Brain / Scribe and add it.");
    const contents = history.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{text:m.content}]
    }));
    const body = {
      systemInstruction: {parts:[{text: PERSONA + await scribeContext()}]},
      contents,
      generationConfig: {temperature:0.82, maxOutputTokens:4096}
    };
    let last = "";
    for (const model of CONFIG.geminiModels) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method:"POST",
          headers:{"Content-Type":"application/json","x-goog-api-key":key},
          body:JSON.stringify(body)
        });
        const data = await res.json();
        if (res.ok) {
          const text = data?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("").trim();
          if (text) return {text, model};
        }
        last = data?.error?.message || `HTTP ${res.status}`;
      } catch(e) { last = e.message; }
    }
    throw new Error(last || "Gemini didn't answer.");
  }

  async function send(text) {
    text = (text || "").trim();
    if (!text) return;

    if (!$("chat") || $("chat").hidden) renderChat();
    addMessage("user", text);
    history.push({role:"user",content:text});

    const thinking = addMessage("assistant", "Thinking. Try not to contain your excitement.");
    thinking.classList.add("thinking");

    try {
      const result = await askGemini();
      history.push({role:"assistant",content:result.text});
      thinking.classList.remove("thinking");
      thinking.innerHTML = md(result.text);
      await autoMemory(text).catch(console.error);
      await saveCurrent();
      setCloudUI();
    } catch(e) {
      thinking.classList.remove("thinking");
      thinking.innerHTML = `<strong>Null failed.</strong><br><br>${esc(e.message || "Unknown error")}`;
    }
  }

  async function deleteAll() {
    if (!uid) return;
    const c = await chatsRef().get();
    const m = await scribeRef().get();
    const batch = db.batch();
    c.docs.forEach(d=>batch.delete(d.ref));
    m.docs.forEach(d=>batch.delete(d.ref));
    await batch.commit();
    chats=[]; history=[]; currentId=null;
    renderChatList(); renderScribe(); renderHome();
  }

  function openPanel(id) { const el=$(id); if(el) el.classList.add("open"); }
  function closePanel(id) { const el=$(id); if(el) el.classList.remove("open"); }

  window.NullCore = {
    init() {
      renderProse();
      renderHome();
      renderChatList();
      initCloud();
    },
    newChat, send, openChat,
    openPanel, closePanel,
    saveMemory, deleteAll,
    getGeminiKey(){ return localStorage.getItem(CONFIG.keyName) || ""; },
    saveGeminiKey(k){ if(k) localStorage.setItem(CONFIG.keyName,k); setCloudUI(); },
    getState(){ return {authReady,uid,currentId,history:[...history]}; }
  };
})();
