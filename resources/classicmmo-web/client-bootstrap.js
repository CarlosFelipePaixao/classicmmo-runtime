/* Shared data/session adapter. Loaded before the EasyRPG module in every client. */
(() => {
  "use strict";
  if (window.__LUMNIA_SHARED_CLIENT__) return;
  window.__LUMNIA_SHARED_CLIENT__ = true;
  const query = new URLSearchParams(location.search);
  const configuredServer = window.LUMNIA_SERVER_URL || "wss://lumnia-server.onrender.com";
  const requestedServer = query.get("server") || configuredServer;
  let expectedServer = configuredServer;
  let serverAllowed = false;
  try {
    const requested = new URL(requestedServer);
    const configured = new URL(configuredServer);
    serverAllowed = requested.origin === configured.origin ||
      (["localhost", "127.0.0.1"].includes(location.hostname) &&
       ["localhost", "127.0.0.1"].includes(requested.hostname));
    if (!["ws:", "wss:"].includes(requested.protocol)) serverAllowed = false;
    if (serverAllowed) expectedServer = requestedServer;
  } catch (_) {}
  const key = "lumnia-entry-session";
  let session = {};
  try { session = JSON.parse(sessionStorage.getItem(key) || "{}"); } catch (_) {}
  if (query.get("token")) {
    session = { token: query.get("token"), characterId: query.get("characterId") };
    try { sessionStorage.setItem(key, JSON.stringify(session)); } catch (_) {}
    const clean = new URL(location.href);
    clean.searchParams.delete("token");
    history.replaceState(null, "", clean.pathname + clean.search + clean.hash);
  }
  window.LumniaSession = {
    getToken: () => serverAllowed && typeof session.token === "string" ? session.token : "",
    characterId: session.characterId || "",
    serverUrl: expectedServer
  };
  window.LumniaState = { character: null, stats: null, position: null, connected: false };
  const electron = Boolean(window.lumniaDesktop);
  const mobile = !electron && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  window.__LUMNIA_CLIENT_PROFILE__ = mobile ? "mobile" : "pc";
  window.__LUMNIA_LAUNCHER_GAME__ = true;
  const assetBase = new URL("./assets/client/", location.href);
  if (!electron) {
    window.lumniaDesktop = Object.freeze({
      getAsset: async name => {
        if (name === "hud") return new URL("hud-overlay.png", assetBase).href;
        if (/^item:[a-z0-9_]+$/.test(name)) return new URL("items/" + name.slice(5) + ".png", assetBase).href;
        throw new Error("Imagem desconhecida.");
      },
      toggleFullscreen: async () => document.fullscreenElement
        ? document.exitFullscreen() : document.documentElement.requestFullscreen(),
      isFullscreen: async () => Boolean(document.fullscreenElement)
    });
  }
  document.documentElement.dataset.lumniaProfile = mobile ? "mobile" : "pc";
  document.documentElement.dataset.lumniaContainer = electron ? "electron" : "browser";
  if (!mobile) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("hud.css", assetBase).href;
    document.head.appendChild(link);
  }

  function emit(name, detail) { window.dispatchEvent(new CustomEvent(name, { detail })); }
  window.__LUMNIA_REWARD_RESULTS__ = {};
  for (const [event, result] of [["lumnia:reward-applied", 1], ["lumnia:reward-failed", -1]]) {
    window.addEventListener(event, value => {
      const rewardKey = value.detail?.rewardKey;
      if (rewardKey) window.__LUMNIA_REWARD_RESULTS__[rewardKey] = result;
    });
  }
  let gameSocket = null;
  const NativeSocket = window.WebSocket;
  // Uses the runtime's existing authenticated connection: no duplicate session.
  window.WebSocket = class LumniaSocket extends NativeSocket {
    constructor(url, protocols) {
      super(url, protocols);
      if (String(url).replace(/\/$/, "") !== expectedServer.replace(/\/$/, "")) return;
      gameSocket = this;
      this.addEventListener("open", () => {
        window.LumniaState.connected = true;
        window.LumniaState.connectionCode = 0;
        emit("lumnia:connection", { connected: true });
      });
      this.addEventListener("close", event => {
        if (gameSocket !== this) return;
        window.LumniaState.connected = false;
        window.LumniaState.connectionCode = event.code;
        if (event.code === 4003) window.__LUMNIA_HUD__?.warning?.("Sua sessão expirou. Volte ao portal para entrar novamente.");
        if (event.code === 4001) window.__LUMNIA_HUD__?.warning?.("Sua conta entrou em outra janela.");
        emit("lumnia:connection", { connected: false, code: event.code });
      });
      this.addEventListener("message", event => {
        let message;
        try { message = JSON.parse(event.data); } catch (_) { return; }
        if (!message || typeof message !== "object") return;
        if (message.type === "chat") {
          window.__LUMNIA_HUD__?.chat?.({ channel: "local", author: message.author || "Jogador", message: message.text });
        }
        if (message.type === "error") window.__LUMNIA_HUD__?.warning?.(message.message);
      });
    }
    send(data) {
      try {
        const message = JSON.parse(data);
        if (message?.type === "position") {
          window.LumniaState.position = { mapId: String(message.mapId), x: message.x, y: message.y };
          emit("lumnia:position", window.LumniaState.position);
        }
      } catch (_) {}
      return super.send(data);
    }
  };
  window.LumniaChat = {
    send(text) {
      if (!gameSocket || gameSocket.readyState !== NativeSocket.OPEN) return false;
      gameSocket.send(JSON.stringify({ type: "chat", text }));
      return true;
    }
  };

  function applyInventory(payload) {
    if (payload.character) window.LumniaState.character = payload.character;
    if (payload.stats) window.LumniaState.stats = payload.stats;
    emit("lumnia:state", window.LumniaState);
  }
  window.addEventListener("lumnia:inventory", event => applyInventory(event.detail || {}));
  window.addEventListener("lumnia:progression", event => {
    window.LumniaState.character = { ...window.LumniaState.character, ...event.detail };
    emit("lumnia:state", window.LumniaState);
  });
  window.addEventListener("lumnia:stats-updated", event => {
    window.LumniaState.stats = event.detail;
    emit("lumnia:state", window.LumniaState);
  });

  if (mobile) {
    document.addEventListener("DOMContentLoaded", () => {
      const notice = document.createElement("div");
      notice.className = "lumnia-mobile-notice";
      notice.setAttribute("role", "status");
      notice.style.cssText = "position:fixed;top:8px;left:50%;transform:translateX(-50%);max-width:70vw;background:#111e;color:#fff;padding:6px 10px;z-index:100;pointer-events:none;font:14px sans-serif;display:none";
      document.body.appendChild(notice);
      let timer;
      const show = text => {
        notice.textContent = String(text || ""); notice.style.display = "block";
        clearTimeout(timer); timer = setTimeout(() => { notice.style.display = "none"; }, 5000);
        return true;
      };
      const api = expectedServer.replace(/^ws/, "http").replace(/\/$/, "");
      const request = async (path, body) => {
        const response = await fetch(api + path, { method: body ? "POST" : "GET",
          headers: { Authorization: "Bearer " + window.LumniaSession.getToken(), "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Não foi possível atualizar seu personagem.");
        applyInventory(payload);
        return payload;
      };
      window.__LUMNIA_HUD__ = {
        inventory: async payload => { applyInventory(payload); return true; },
        battleReward: ({ experience, gold }) => show(`+${experience} EXP · +${gold} ouro`),
        warning: show, notice: show,
        chat: ({ author, message }) => show(`${author}: ${message}`),
        loot: value => show(value.message || "Item recebido.")
      };
      request("/api/inventory").catch(error => show(error.message));
      window.addEventListener("lumnia:reward-request", event => {
        const rewardKey = event.detail?.rewardKey;
        request("/api/rewards/claim", { rewardKey })
          .then(payload => { show(payload.message); emit("lumnia:reward-applied", { rewardKey }); })
          .catch(error => { show(error.message); emit("lumnia:reward-failed", { rewardKey }); });
      });
      window.__lumniaPcRewardBridgeReady = true;
      for (const detail of window.__lumniaPendingRewardRequests || []) {
        emit("lumnia:reward-request", detail);
      }
      window.__lumniaPendingRewardRequests = [];
    });
  }
})();
