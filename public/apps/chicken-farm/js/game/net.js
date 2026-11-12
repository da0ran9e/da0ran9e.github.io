// Trại Gà — client gọi server M2 (server có thẩm quyền). Xem server/README.md.
// Client chỉ gửi Ý ĐỊNH; server dùng giờ của server, tự tung ngẫu nhiên, trả về trại đã bỏ seed.

export function createNet(base) {
  base = base.replace(/\/+$/, "");
  const tokenKey = `trai-ga-token|${base}`;
  let token = null;
  try {
    token = localStorage.getItem(tokenKey);
  } catch {}

  async function req(method, path, body, { keepalive = false } = {}) {
    let res;
    try {
      res = await fetch(base + path, {
        method,
        keepalive,
        headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      return { ok: false, code: "offline", message: "Không kết nối được máy chủ", status: 0 };
    }
    let json;
    try {
      json = await res.json();
    } catch {
      json = { ok: false, code: "bad_response", message: `Máy chủ trả lỗi ${res.status}` };
    }
    if (!res.ok && json.ok !== false) json.ok = false;
    json.status = res.status;
    if (res.status === 429) json.message ??= "Thao tác nhanh quá, thử lại sau giây lát";
    return json;
  }

  // id hành động do client sinh để gửi lại an toàn (server bỏ qua bản trùng)
  const aid = () => (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);

  return {
    base,
    hasToken: () => !!token,
    async ensureGuest() {
      if (token) return true;
      const r = await req("POST", "/api/guest", {});
      if (!r.token) throw new Error(r.message || "Không tạo được tài khoản khách");
      token = r.token;
      try {
        localStorage.setItem(tokenKey, token);
      } catch {}
      return true;
    },
    forget() {
      token = null;
      try {
        localStorage.removeItem(tokenKey);
      } catch {}
    },
    hello: () => req("GET", "/api/hello"),
    farm: () => req("GET", "/api/farm"),
    starters: () => req("GET", "/api/starters"),
    newFarm: (choice) => req("POST", "/api/farm/new", { aid: aid(), choice }),
    act: (name, args = {}, opts) => req("POST", `/api/farm/${name}`, { aid: aid(), ...args }, opts),
    watch: () => req("POST", "/api/field/watch", {}),
  };
}
