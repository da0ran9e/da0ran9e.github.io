// Cổng đăng nhập dùng chung cho các app (magic link qua Supabase Auth).
// Nhúng vào mỗi trang app: <script type="module" src="/auth.js"></script>
// Sau khi đăng nhập, các app dùng window.AUTH.client + window.AUTH.ready.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm"

const SUPABASE_URL = "https://huhzwawyysehjtofkpvb.supabase.co"
const SUPABASE_KEY = "sb_publishable_U0L64ODHeuid599c6oRgvw_5fM-2D8n"
const sb = createClient(SUPABASE_URL, SUPABASE_KEY)

let resolveReady
window.AUTH = { client: sb, url: SUPABASE_URL, ready: new Promise((r) => (resolveReady = r)) }

// ---- overlay ----
const style = document.createElement("style")
style.textContent = `
  #__authgate{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(160deg,#0c1320,#11202e);font-family:Inter,Helvetica,Arial,sans-serif;color:#eaf1f8}
  #__authgate .box{width:340px;max-width:88vw;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);
    border-radius:16px;padding:26px 24px;box-shadow:0 20px 60px rgba(0,0,0,.5);backdrop-filter:blur(6px)}
  #__authgate h2{font-size:20px;font-weight:900;letter-spacing:-.01em;margin-bottom:6px}
  #__authgate p{font-size:12.5px;color:#9fb3c8;line-height:1.5;margin-bottom:16px}
  #__authgate input{width:100%;font-family:inherit;font-size:14px;padding:11px 13px;border-radius:10px;border:1px solid rgba(255,255,255,.18);
    background:rgba(255,255,255,.06);color:#fff;outline:none;margin-bottom:10px}
  #__authgate input:focus{border-color:#37c2a3}
  #__authgate button{width:100%;font-family:inherit;font-weight:700;letter-spacing:.04em;font-size:13px;padding:11px;border:none;border-radius:10px;
    background:#37c2a3;color:#04261f;cursor:pointer;transition:.15s}
  #__authgate button:hover{filter:brightness(1.08)} #__authgate button:disabled{opacity:.6;cursor:default}
  #__authgate .msg{font-size:12px;margin-top:12px;min-height:16px;color:#bcd}
  #__authgate .msg.err{color:#ff9a8a} #__authgate .msg.ok{color:#7fe6c8}
  #__authgate .foot{margin-top:16px;font-size:10.5px;color:#5f7488}
`
function makeOverlay() {
  const o = document.createElement("div")
  o.id = "__authgate"
  o.innerHTML = `
    <div class="box">
      <h2>Khu vực riêng tư</h2>
      <p>Đây là phần chỉ dành cho người được mời. Nhập email của bạn để nhận đường link đăng nhập.</p>
      <form id="__af"><input id="__ae" type="email" placeholder="email@example.com" autocomplete="email" required />
      <button id="__ab" type="submit">Gửi link đăng nhập</button></form>
      <div class="msg" id="__am"></div>
      <div class="foot">Vũ Đức An · bảo vệ bằng Supabase Auth</div>
    </div>`
  return o
}

let ov = null
function showOverlay() {
  if (ov) return
  document.documentElement.appendChild(style)
  ov = makeOverlay()
  document.documentElement.appendChild(ov)
  const form = ov.querySelector("#__af")
  const email = ov.querySelector("#__ae")
  const btn = ov.querySelector("#__ab")
  const msg = ov.querySelector("#__am")
  form.addEventListener("submit", async (e) => {
    e.preventDefault()
    btn.disabled = true; msg.className = "msg"; msg.textContent = "Đang gửi…"
    const { error } = await sb.auth.signInWithOtp({
      email: email.value.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: window.location.href },
    })
    btn.disabled = false
    if (error) { msg.className = "msg err"; msg.textContent = "Email không được phép hoặc có lỗi: " + error.message }
    else { msg.className = "msg ok"; msg.textContent = "Đã gửi link tới " + email.value.trim() + ". Mở email và bấm vào link để vào." }
  })
}
function hideOverlay() { if (ov) { ov.remove(); ov = null } }

sb.auth.onAuthStateChange((_event, session) => {
  if (session) { hideOverlay(); resolveReady(session) }
})

;(async () => {
  const { data: { session } } = await sb.auth.getSession()
  if (session) { resolveReady(session) }
  else showOverlay()
})()
