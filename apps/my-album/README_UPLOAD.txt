MY ALBUM - THEM ANH VA XOA ANH TU TRANG WEB

Trang web chi doc file. De them/xoa anh can chay them mot dich vu ghi nho
tren may Windows, canh server anh dang chay.

  - Them anh: tep duoc luu vao  <goc album>\Tai_len\<nam-thang>\
  - Xoa anh : KHONG xoa that. Tep duoc chuyen vao  <goc album>\_Thung_rac\
              (giu nguyen duong dan cu) va khong hien tren trang nua.
              Muon lay lai: chuyen tep ra khoi _Thung_rac.
  - Ca hai duoc ghi vao album\changes.json de trang hien thay doi ngay,
    truoc khi chay lai index_photos.py / build_metadata_versions.py.

1. CAI DAT (mot lan)

  - Chep album_write_server.py va start_album_write_server.cmd vao mot thu muc,
    vi du E:\PhotoIndex\.
  - (Nen co) cai Pillow de tao thumbnail va doc ngay chup cho anh moi:
        py -m pip install pillow pillow-heif
    Khong co Pillow van chay duoc, chi la anh moi chua co thumbnail rieng.
  - Mo start_album_write_server.cmd bang Notepad, sua ALBUM_ROOT neu thu muc
    goc dang chia se khong phai E:\Pictures (thu muc chua album\ va thumbs\).

2. CHAY

  - Nhan dup start_album_write_server.cmd. Cua so phai hien dong
        My Album write service on http://127.0.0.1:8010
  - Dich vu chi nghe tren 127.0.0.1 nen chi cloudflared vao duoc.

3. NOI VAO CLOUDFLARE TUNNEL (mot lan)

  Duong /api/ cua photos.vuducan.qzz.io phai di toi cong 8010, phan con lai
  van di toi server anh cu.

  a) Tunnel quan ly tren dashboard (Zero Trust > Networks > Tunnels):
       Public Hostname > Add:
         Subdomain: photos   Domain: vuducan.qzz.io   Path: api/*
         Service:   HTTP     URL: localhost:8010
       Keo dong nay len TREN dong photos.vuducan.qzz.io cu.

  b) Tunnel dung config.yml:
       ingress:
         - hostname: photos.vuducan.qzz.io
           path: ^/api/
           service: http://localhost:8010
         - hostname: photos.vuducan.qzz.io
           service: http://localhost:8000      (giu nhu cu)
         - service: http_status:404
     Roi khoi dong lai cloudflared.

  Cloudflare Access dang bao ve photos.vuducan.qzz.io se tu bao ve ca /api/.

4. KIEM TRA

  - Mo https://photos.vuducan.qzz.io/api/status (da dang nhap) -> thay {"ok": true ...}
  - Tai lai trang My Album: nut "Them anh" hien tren thanh tren cung,
    nut "Xoa" hien khi chon anh va trong trinh xem anh.

5. LUU Y

  - Moi tep toi da 95 MB (Cloudflare goi mien phi chan request > 100 MB).
    Video dai hon hay chep truc tiep vao may.
  - Nen them _Thung_rac vao danh sach bo qua cua index_photos.py de khong tao
    thumbnail cho anh da xoa. Trang web van an chung du khong bo qua.
  - Neu nut tai len bao loi CORS: trong Zero Trust > Access > Applications >
    photos > Settings > CORS, cho phep origin https://vuducan.qzz.io,
    phuong thuc GET va POST, va "Allow credentials".
