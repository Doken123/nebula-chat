# 🌌 NebulaChat

Chat publik real-time dengan tema nebula. Setiap user punya akun, bisa chat siapa saja.

## Stack
- **Frontend**: HTML/CSS/JS → Vercel
- **Backend**: Node.js + Express + SQLite + WebSocket → Railway

## Deploy
- Backend: Railway (root = `backend/`)
- Frontend: Vercel (root = `frontend/`)
- Update `frontend/config.js` dengan URL backend Railway
- Update `FRONTEND_URL` di Railway dengan URL Vercel

## Development
```bash
cd backend
npm install
npm start