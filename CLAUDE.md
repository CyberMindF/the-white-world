# Il Mondo Bianco — convenzioni di progetto

## Zero codice duplicato

Regola fissata il 09/08/2026: la duplicazione di codice (HTML, CSS, JS) deve tendere il più possibile a zero. Se lo stesso markup, la stessa regola CSS o la stessa logica dovrebbero ripetersi identici su più pagine, vanno estratti in qualcosa di condiviso invece di essere copiati e incollati.

**Contesto**: il frontend attivo è la SPA Angular in `web/`. Il precedente sito HTML/JavaScript è conservato solo come riferimento reversibile in `legacy-archive/` e non deve essere importato o pubblicato. Prima della migrazione, aggiungere un'icona alla barra utente aveva richiesto modificare 15 file: è il caso concreto che ha motivato questa regola. In Angular la shell comune vive in `web/src/app/shell/`, la logica condivisa in `web/src/app/core/` e `web/src/app/shared/`, le pagine in `web/src/app/pages/`.

**Come applicarla**:
- CSS condiviso: usare prima `web/src/styles/components/`; bottoni, card e form hanno gia' primitive comuni. I CSS specifici vivono in `web/src/styles/pages/`.
- Il frontend Angular e' autosufficiente: asset e contenuti pubblici vivono in `web/public/`. Non creare symlink verso la root o reintrodurre `asset-root`.
- UI e logica condivise: usare `AppShell`, i componenti in `web/src/app/shared/` e i servizi in `web/src/app/core/`; non copiare header, userbar, autenticazione, temi o telemetria nei componenti pagina.
- `legacy-archive/` è sola documentazione storica: non correggere il nuovo frontend importando codice da lì. Se serve recuperare un comportamento, portarlo esplicitamente in TypeScript e verificarlo.

## Colori e componenti del design system

- I colori dell'interfaccia devono usare sempre variabili semantiche definite in
  `web/src/styles/themes.css`. Non inserire colori letterali nei CSS di una pagina o di un
  componente quando il valore appartiene al tema (testo, sfondo, bordo, stato, overlay).
- Se manca un token, aggiungerlo a tutti i temi con un nome legato al suo significato, non al
  colore concreto. Le palette fisse sono ammesse solo dentro illustrazioni/effetti che
  rappresentano un oggetto con colori propri e non fanno parte della UI tematica.
- Un comportamento o uno stile comune va risolto nella primitiva o nel componente condiviso.
  Le pagine dichiarano soltanto le varianti semantiche necessarie e non duplicano correzioni
  locali del design system.

Vedi `prossimi sviluppi.md` per le cose ancora aperte sul progetto.

## Voce dei testi

Il sito è scritto da Rory per Desy: la voce è sempre **io che parlo a te**, non una terza persona che parla alla coppia. Rivolgersi a lei al singolare ("hai", "puoi", "scegli"); per attività o risorse condivise usare "noi", "abbiamo", "possiamo", "nostro". Non usare "voi", "avete", "potete" o "vostro" per rivolgersi ai due utenti. La regola vale anche per istruzioni, conferme, errori, notifiche e Novità, sia nel frontend sia nei testi generati dal backend o salvati nel CMS.

Valutare il contesto: citazioni, dialoghi, narrazioni GDR, materiali di studio e registri delle azioni con autore esplicito mantengono la propria voce. Le etichette amministrative che identificano destinatari o permessi (per esempio "A entrambi") restano descrittive. Evitare riscritture automatiche che confondano chi ha compiuto un’azione o cambino il significato delle regole di gioco.

- Nelle Novità non usare l’emoji del cuore bianco; preferire un simbolo pertinente al contenuto.

## Pubblicazione obbligatoria tramite GitHub

Seguire l’iter in `README.md`, sezione Pubblicazione: integrare le modifiche remote, verificare build e controlli, applicare le eventuali migrazioni necessarie e registrare/inviare tutto il rilascio su GitHub (`main`). Attendere la pubblicazione automatica e verificare il commit online. Non pubblicare direttamente su Cloudflare, né tramite CLI né dal pannello, e non lasciare novità online assenti da GitHub.
