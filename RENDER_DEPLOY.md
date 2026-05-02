# Deploy pe Render

Dashboardul este o aplicație Vite/React statică. La build, scriptul `npm run ingest`
încearcă să descarce automat metadatele CKAN și cele 36 de fișiere XLSX de pe
data.gov.ro, normalizează datele și generează `public/data/dashboard-data.json`.
Fișierele brute sunt ignorate în git, dar `public/data/dashboard-data.json` trebuie
urcat în repo ca fallback. Așa deploy-ul nu pică dacă data.gov.ro răspunde lent în
timpul build-ului Render.

## Ce urci pe GitHub

Urcă doar codul sursă:

- `index.html`
- `package.json`
- `package-lock.json`
- `vite.config.js`
- `scripts/`
- `src/`
- `public/data/dashboard-data.json`
- `.gitignore`
- `RENDER_DEPLOY.md`

Nu urca:

- `node_modules/`
- `dist/`
- `data/raw/`
- `data/package.json`
- `src/data/`
- fișiere `.log`

## Setări Render

1. Intră în Render Dashboard.
2. Click `New` -> `Static Site`.
3. Conectează repo-ul GitHub.
4. Alege branch-ul, de obicei `main`.
5. Completează:

```text
Build Command: npm install && npm run build
Publish Directory: dist
```

6. Click `Create Static Site`.

Render va rula build-ul, va încerca să actualizeze datele din sursa publică și va
publica folderul `dist` la o adresă de forma:

```text
https://numele-proiectului.onrender.com/
```

## Test local înainte de deploy

```bash
npm install
npm run build
npm run preview
```

`npm run build` trebuie să termine fără erori. Dacă data.gov.ro nu răspunde în
momentul build-ului, scriptul folosește automat copia cache din
`public/data/dashboard-data.json`.
