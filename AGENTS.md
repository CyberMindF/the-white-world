# Istruzioni di progetto

## Pubblicazione

Per questo progetto si pubblica esclusivamente tramite GitHub, sul branch `main`. Seguire l’iter completo nella sezione Pubblicazione di `README.md`.

- Integrare le modifiche remote preservando il lavoro locale.
- Eseguire build e controlli pertinenti.
- Verificare e applicare le eventuali migrazioni al database remoto prima del codice che ne dipende.
- Registrare e inviare su GitHub tutte le modifiche del rilascio, inclusi nuovi file e migrazioni.
- Attendere la pubblicazione automatica e verificare che `/build-version.json` online corrisponda al commit inviato.
- Non pubblicare direttamente su Cloudflare tramite CLI o pannello. Non aggirare una build automatica fallita con un deploy diretto.

Cloudflare è la piattaforma che ospita il sito e riceve automaticamente il codice da GitHub; non è un percorso alternativo di pubblicazione. Il rilascio è completo solo quando GitHub e produzione sono allineati.
