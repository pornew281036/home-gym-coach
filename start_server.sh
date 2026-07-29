#!/bin/zsh
# เปิดเซิร์ฟเวอร์ให้มือถือเข้าผ่าน Wi‑Fi เดียวกันได้
cd "$(dirname "$0")"
PORT="${1:-8765}"

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "หา IP ไม่เจอ")

echo ""
echo "=== Home Gym Coach ==="
echo "บน Mac เปิด:   http://127.0.0.1:${PORT}"
echo "บนมือถือเปิด: http://${IP}:${PORT}"
echo "(มือถือกับ Mac ต้องอยู่ Wi‑Fi เดียวกัน)"
echo "กด Ctrl+C เพื่อหยุด"
echo ""

python3 -m http.server "$PORT"
