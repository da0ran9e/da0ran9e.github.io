# Claude Code Game Studios (đã nạp một phần)

Nguồn: https://github.com/Donchitos/Claude-Code-Game-Studios (MIT, bản 1.3.0, commit abc0de7) — xem `CCGS-LICENSE`.

Đã chép: `skills/` (78), `agents/` (49), `rules/`, `docs/`, `genres/`, `engines/`, `scripts/`, `hooks/`.

**CHƯA bật** (cố ý): `settings.json` của bộ này — 15 hook tự chạy script shell ở mỗi lần đọc/ghi/commit/push và đầu/cuối phiên,
`update-check.sh` gọi GitHub hằng ngày, danh sách quyền cho phép sẵn, thanh trạng thái. Repo này còn chứa trang cá nhân và
My Album nên không gắn hook toàn repo. Muốn bật: chép `settings.json` từ repo gốc vào `.claude/settings.json` (hoặc chỉ phần cần).

Không chép `CLAUDE.md` / `project.yaml` gốc của bộ (sẽ đổi chỉ dẫn cho cả repo). Game Trại Gà nằm ở `public/apps/chicken-farm/`,
tài liệu thiết kế ở `docs/chicken-farm/`.
