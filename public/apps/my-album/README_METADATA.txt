TRICH XUAT METADATA MY ALBUM TREN WINDOWS

Script: extract_album_metadata.py
Ket qua mac dinh: album-metadata.json trong thu muc goc cua album.

CHUAN BI EXIFTOOL

1. Tai ban Windows cua ExifTool tai https://exiftool.org/.
2. Giai nen ExifTool.
3. Doi ten exiftool(-k).exe thanh exiftool.exe.
4. Dat exiftool.exe va thu muc exiftool_files canh extract_album_metadata.py.

CACH CHAY DON GIAN

- Nhan dup extract_album_metadata.cmd, sau do chon thu muc album.

- Neu da tung chay goi My Album LAN, script tu doc thu muc trong
  album-lan-config.json:

    py extract_album_metadata.py

- Hoac chi dinh thu muc album:

    py extract_album_metadata.py "D:\Photos"

Script chi doc file. Anh va video goc khong bi sua.

NOI DUNG JSON

- Tat ca tag ma ExifTool doc duoc, gom EXIF, XMP, IPTC, MakerNotes,
  QuickTime/MOV, GPS, camera, kich thuoc, thoi luong va metadata nhung.
- Moi item co them _album.path, folder, type, bytes, modified va fingerprint.
- Duong dan trong JSON la duong dan tuong doi, khong ghi o dia Windows.
- Thu muc thumbnail, cache va _my-album duoc bo qua.

AP DUNG VAO MY ALBUM

- Dat album-metadata.json trong thu muc goc cua album (day cung la vi tri mac dinh).
- My Album LAN API v7 tu doc file nay; khong can chuyen JSON len trinh duyet.
- Khoi dong lai start_my_album.cmd sau khi cap nhat goi server. Tren giao dien,
  trang thai ket noi se hien "EXIF" khi metadata da duoc nhan.
- Timeline uu tien ngay chup, bo loc co them may anh/GPS, va bang Thong tin hien
  camera, ong kinh, thong so chup, kich thuoc, thoi luong va toa do neu co.
- Sau nhung lan trich xuat tiep theo, bam Lam moi album de doc file JSON moi.

CHAY LAI

Mac dinh script chi doc lai file moi hoac da thay doi. Metadata cua file khong
doi duoc tai su dung; file da xoa cung bi loai khoi JSON.

    py extract_album_metadata.py "D:\Photos" --force

Tuy chon huu ich:

- --pretty: JSON de doc hon, nhung lon hon.
- --fast: bo qua metadata nhung/streaming de chay nhanh hon.
- --include-binary: kem binary metadata dang base64; file JSON co the rat lon.
- --output ten-khac.json: doi ten file dau ra.

Voi album lon, lan quet dau co the mat nhieu phut. Khong dong cua so cho den
khi thay dong "Done". Script ghi file tam va chi thay album-metadata.json sau
khi quet xong.
