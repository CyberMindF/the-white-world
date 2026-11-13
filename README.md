# Il Mondo Bianco

Applicazione del Mondo Bianco con frontend Angular, autenticazione tramite Cloudflare Pages Functions e dati su D1. Il precedente frontend HTML/JavaScript è conservato in `legacy-archive/` soltanto per confronti e ripristini durante il cutover.

## Avvio locale

Installa le dipendenze, prepara la chiave locale e applica le migrazioni:

```bash
npm install
npm --prefix web install
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply DB --local
```

Modifica `WORLD_KEY` dentro `.dev.vars`.

**Un solo comando** (consigliato): avvia backend e frontend insieme, build compresa:

```bash
npm run dev
```

**Oppure, due terminali separati** (utile per vedere i log dei due processi divisi): nel primo il backend —

```bash
npm run build
npm run dev:api
```

— nel secondo Angular:

```bash
npm start
```

Apri `http://localhost:4201`. Angular inoltra `/api/**` al backend locale su `http://localhost:8788` tramite `web/proxy.conf.json`; la porta 8788 non è il frontend di sviluppo.

### Porte fisse, per non ritrovarsi processi in conflitto

`4201` (frontend) e `8788` (backend) sono fissate in `web/angular.json` e negli script sopra:
non usare mai `ng serve` senza `--port`, altrimenti si torna alla porta di default (`4200`) e
si rischia di avviare una seconda istanza in conflitto con quella già aperta in un altro
terminale. Il backend resta uno solo condiviso su `8788` (non ha senso duplicarlo, è la stessa
app/DB). Una sessione di Claude Code che ha bisogno di una propria istanza del frontend per
verificare qualcosa (screenshot, test end-to-end) usa invece `4202`
(`ng serve --port 4202`, stesso `proxy.conf.json`, punta comunque a `8788`) — mai `4201`, per
non interferire con un server che l'utente potrebbe avere già aperto.

## Autenticazione

Gli endpoint sono organizzati in `functions/api/auth/`:

- `POST /api/auth/register`: registra il secondo e ultimo account principale e crea una sessione. Il nickname è scelto liberamente in fase di registrazione (facoltativo: se vuoto, resta la parte dell'email prima della chiocciola). La preferenza `notify_email_updates` è impostabile solo qui, non al login, perché prima dell'autenticazione non si conosce ancora l'utente per pre-spuntarla correttamente; salva solo la preferenza, l'invio delle email non è implementato.
- `POST /api/auth/login`: verifica email, password e chiave, poi crea una sessione.
- `GET /api/auth/session`: controlla se il token è ancora valido.
- `POST /api/auth/session`: con token valido, verifica nuovamente la chiave.

Il token originale viene inviato in un cookie `HttpOnly`; D1 conserva soltanto il suo hash. La sessione scade dopo 7 giorni e viene rinnovata per altri 7 giorni soltanto quando la chiave viene inviata correttamente. Il controllo automatico eseguito all'apertura non prolunga la sessione. La verifica della chiave vale solo per la scheda corrente tramite `sessionStorage`, quindi viene richiesta nuovamente dopo la chiusura della sessione browser.

### Account di prova e rollback

`identity` (`lui`/`lei`) è soltanto una label narrativa. Proprietà e autorizzazioni usano sempre
`users.id`; anche carte, bustine, streak e scambi appartengono quindi all'account preciso.

Con Modalità admin attiva, `POST /api/auth/test-account` crea un account marcato `is_test=1` e
`GET /api/auth/test-account` li elenca. Un account test può scrivere soltanto dati personali o
additivi esplicitamente annullabili: chat e relativi allegati, lettere, turni e appunti GDR,
cruciverba, suggerimenti e bustine. Scambi, contenuti editoriali e impostazioni condivise sono
bloccati. `POST /api/auth/test-account/:id/reset` elimina sessioni, telemetria, ricevute di lettura,
dati personali e oggetti R2 della chat, conservando account e credenziali; `DELETE
/api/auth/test-account/:id` esegue la stessa pulizia e poi elimina definitivamente l'account.
Entrambe le operazioni sono disponibili in **Amministrazione → Account di collaudo** con
Modalità admin attiva. La pagina `/amministrazione` si apre dall’icona a scudo nella barra
utente, visibile soltanto con Modalità admin attiva, ed è riservata agli amministratori:
raccoglie anche i controlli per registrazione attività, abilitazione email, avvisi manuali,
contenuti e Log. Il Profilo conserva soltanto
le impostazioni personali; l’interruttore della Modalità admin resta nella barra condivisa.

### Pagine protette e ritorno dopo l'accesso

Le route protette sono raccolte sotto `authGuard` in `web/src/app/app.routes.ts`. Se sessione o Chiave della scheda non sono valide, il Router conserva la destinazione richiesta e torna al Portone; dopo login, registrazione o conferma della Chiave riprende la navigazione originale. Sono accettate soltanto destinazioni dello stesso dominio e mai URL sotto `/api/`.

## Contatore dell’Amore (privato)

La pagina `/contatore-amore` si apre da **Amministrazione**, solo per gli
amministratori, anche senza Modalità admin attiva. Ogni amministratore vede esclusivamente
i propri dati: la API verifica ruolo e proprietario su ogni lettura e scrittura. Nessun
contenuto viene inviato alla telemetria, alle notifiche o alla chat; la presenza condivisa
mostra soltanto “Profilo”. Non è incluso nell’esportazione dei contenuti condivisi.

Applicare `0125_add_love_counter.sql` prima di pubblicare il frontend. Le due tabelle
`love_counter_settings` e `love_counter_episodes` sono legate a `users.id`. Il totale è
sempre derivato dalla base (20, configurabile) e dagli episodi; la base non azzera lo storico.
Date ISO UTC, visualizzazione e modifica nel fuso locale del dispositivo. La statistica
settimanale usa gli ultimi sette giorni mobili; le date future non entrano in tale finestra.
La scala cromatica segue la base positiva, oppure usa 20 come riferimento per basi <= 0.

`POST /api/love-counter` registra ±1 con UUID idempotente e ora server; `PATCH` modifica
un episodio (±1/±2, nota, data) o la base; `DELETE` elimina un episodio. Le revisioni impediscono
sovrascritture silenziose fra schede. Le eliminazioni svuotano la nota e mantengono una
tombstone per impedire che un retry tardivo ricrei l’episodio. Le richieste di salvataggio
usano `keepalive`: lo stato “Salvato” appare soltanto dopo conferma del server, mentre in caso
di errore si può riprovare lo stesso inserimento senza duplicarlo. Nessun salvataggio offline.

Verifiche locali senza dati remoti:

```bash
npm run test:love-counter
npm run build
node scripts/smoke-love-counter.mjs
```

## Media privati (R2)

Il binding `MEDIA` punta al bucket R2 `the-white-world-media`, privato: nessun accesso pubblico o dominio personalizzato, l'unico modo per leggerlo è `GET /api/media/<percorso>`, che verifica la sessione prima di restituire l'oggetto (401 senza sessione valida, 400 su tentativi di path traversal, 404 se l'oggetto non esiste). Il frontend richiama questo endpoint da pagina già protetta dal guard, non serve altra autenticazione lato client.

Convenzione dei percorsi dentro il bucket, per sezione e variante:

```
<sezione>/<identificatore>/original/<file>   # originale conservato integralmente
<sezione>/<identificatore>/web/<file>        # versione ottimizzata per la visualizzazione
<sezione>/<identificatore>/thumb/<file>      # miniatura per gallerie/anteprime
```

Per esempio la Bacheca dei Ricordi userà `bacheca/<periodo>/<giorno>/original|web|thumb/<file>`; l'MP3 bonus delle Cuffiette userà semplicemente `cuffiette/bonus/<file>`. D1 conserva soltanto i percorsi/chiavi da associare ai contenuti, mai i file stessi.

In locale, `wrangler pages dev` emula R2 nello stesso modo di D1; per caricare un oggetto di prova:

```bash
npx wrangler r2 object put the-white-world-media/<percorso> --local --file <file-locale>
```

## La Bacheca dei Ricordi

Periodi e giorni vivono in D1 (`bacheca_periods` e `bacheca_days`). Ogni giorno conserva il
proprio layout validato come JSON, mentre l'interfaccia amministrativa espone soltanto un editor
visuale per righe, colonne e blocchi. Foto, video e audio vengono caricati direttamente nel
bucket R2 privato tramite uno stream autenticato; le miniature fotografiche sono generate nel
browser. La pagina mantiene il lightbox accessibile con tastiera e swipe.

## Nuova esperienza GDR

L’inserimento principale avviene direttamente nel racconto: i piccoli «+» prima, fra e dopo i blocchi aprono un editor nel punto scelto; «Inizia a scrivere» avvia un’avventura vuota. Il menu Inserisci usa gli stessi comandi dell’editor completo, con scelta della voce e anteprima. Aggiunte vuote o sintatticamente incomplete non si possono confermare; annullare non cambia il testo. I blocchi circostanti conservano il proprio contenuto. «Modifica testo completo» resta un comando testuale secondario; salvataggio e pubblicazione delle nuove avventure sono disponibili anche senza aprirlo. Le avventure esistenti continuano a modificare soltanto la copia locale.

La pagina dell’avventura parte dal titolo, senza il vecchio riquadro di laboratorio o selettore delle avventure. Per cambiare storia si usa l’hub. «Gestisci PG e PNG», fra i comandi riservati al master, apre un’area dedicata a creazione, schede, immagini, assegnazioni, importazione ed esportazione; si torna all’avventura dopo aver salvato o annullato le modifiche. Il pannello «Scheda» resta dedicato al giocatore: non mostra creazione, assegnazioni o importazioni del master.

L’ingresso `/tavolo-da-gioco/gdr` conserva l’hub introduttivo e la scelta delle avventure. Le schede aprono la nuova esperienza a `/tavolo-da-gioco/gdr/gioca/<id>`, con l’avventura scelta. La versione classica resta disponibile solo tramite indirizzo diretto a `/tavolo-da-gioco/gdr/classico`, insieme agli URL originali delle avventure; non sono presenti collegamenti dalla nuova interfaccia. Il collegamento `/tavolo-da-gioco/gdr/laboratorio` continua a funzionare. Il pulsante «Nuova avventura» e il relativo modulo sono presenti soltanto nell’hub principale per gli admin non di prova; dopo la creazione si apre l’editor. Anche le nuove avventure visibili all’utente compaiono nell’hub. Il backend verifica comunque il permesso di creazione. Restano valide le limitazioni di salvataggio descritte sotto.

La nuova pagina autenticata, raggiungibile dalle schede nell’hub GDR
(oppure dal collegamento precedente `/tavolo-da-gioco/gdr/laboratorio`), mostra entrambe le avventure con impaginazione e turni storici invariati. Le API storiche
vengono chiamate esclusivamente tramite GET. In locale si vede il database locale.
Le bozze v2 e i turni di prova restano nel browser, separati per account e avventura
(`gdr-laboratorio-v2-<id>-<avventura>`); le precedenti prove v1 non sono cancellate.

L’editor testuale unico con anteprima inserisce comandi al cursore o attorno alla selezione.
Riusa parser, snippet e renderer dei documenti e aggiunge `::: dialogo Nome | /assets/ritratto.webp`,
`::: azione` e `::: nota`, chiusi da `:::`. La voce si sceglie per ciascun inserimento;
“Cambia voce nel dialogo” modifica soltanto l’intestazione del dialogo che contiene il cursore.
I titoli e l’inizio dei blocchi nell’anteprima sono cliccabili: il blocco selezionato
si trasforma in un editor **nella stessa posizione**, con Applica, Annulla e anteprima locale.
Non apre l’editor completo né sposta il focus alla fine del documento. Gli intervalli derivano
dal parser, non da ricerche del testo: paragrafi identici, emoji e CRLF restano distinguibili.
Il resto del documento viene conservato byte per byte nell’applicazione della modifica.
La barra di scrittura è parte della cornice dell’editor. L’editor completo resta disponibile.

I turni di prova non sono ancora pubblicati né sincronizzati: i permessi di interpretazione
filtrano le voci disponibili, ma la futura pubblicazione dovrà verificare anche gli ID dei
personaggi sul server prima di salvare un turno condiviso.

### Nuove avventure e personaggi

La migrazione **0133_add_gdr_workspace.sql** aggiunge soltanto tabelle `gdr_workspace_*`;
**0134_add_gdr_character_profiles.sql** aggiunge profili descrittivi e foto agli stessi personaggi.
Non aggiorna né cancella schede, appunti, blocchi o turni esistenti. Va applicata prima di
abilitare le nuove funzionalità su un ambiente; senza migrazione il laboratorio segnala
l’indisponibilità e continua a mostrare le avventure storiche. Nessuna migrazione remota
viene applicata automaticamente dalla build o dal frontend.

`GET /api/gdr-workspace?adventure=<id>` legge lo stato e `POST /api/gdr-workspace/mutate`
esegue le scritture del laboratorio. Il master corrisponde agli amministratori con permesso
`content.create`, esclusi gli account test. Può creare nuove avventure, scriverne e salvarne
il testo dal sito, conservarle come bozze riservate e renderle visibili agli altri account
nel laboratorio. Le avventure storiche non sono riscrivibili da questi endpoint.

Il master crea PG e PNG e assegna a uno o più utenti permessi distinti di interpretazione,
modifica della scheda (solo PG) e modifica dello zaino. Non esiste un limite client deciso dal
giocatore al numero di PG assegnati; un giocatore non può crearli o assegnarsi permessi.
I PNG restano modificabili nella scheda solo dal master, anche se un giocatore può interpretarli
o gestirne lo zaino. Ogni personaggio ha inventario separato (oggetto, quantità, note).
La scheda storica si può copiare esplicitamente in un nuovo PG, senza modificare l’originale.
“Gestisci PG e PNG” apre il pannello sulla gestione, con elenco ricercabile e filtri, creazione
visibile di PG e PNG, modifica della scheda, assegnazioni e zaino. I PNG già presenti nei blocchi
narrativi possono essere copiati nella gestione; i blocchi originali non vengono riscritti.
Il profilo condiviso comprende nome, cognome, aspetto, carattere, storia, obiettivo e abilità,
oltre agli altri dettagli liberi della scheda. I campi descrittivi sono guidati da una definizione
comune per PG e PNG.

Foto e avatar sono distinti. “Carica foto” prepara un WebP con inquadratura completa (lato massimo
1600px); se manca un avatar, ne prepara uno quadrato da 256px con ritaglio centrale. È possibile
caricare un avatar autonomo o rigenerarlo dalla foto. `POST /api/gdr-workspace/media` verifica
l’autenticazione e i permessi di modifica della scheda prima di ricevere e salvare il WebP in R2
privato (`gdr-workspace/<personaggio>/<photo|avatar>/<uuid>.webp`, massimo 2 MiB per upload).
Il percorso viene registrato nella scheda solo quando si salva. I precedenti file non vengono
cancellati perché possono essere ancora referenziati nei turni. Gli upload annullati possono
lasciare file non referenziati: un’eventuale pulizia dovrà prima verificare tutti i riferimenti.

Import/export JSON `mondobianco.character`, versione 1, include profilo, scheda, inventario e
immagini incorporate. L’import ha anteprima e conferma, crea una nuova copia nell’avventura
corrente e non importa ID, assegnazioni, account o permessi. Foto e avatar vengono ricaricati nei
media privati; gli oggetti ricevono nuovi ID. File e campi sono validati prima di creare il
personaggio, e le immagini vengono decodificate/normalizzate nel browser. Se un caricamento
immagine fallisce dopo la creazione, il personaggio e i dati testuali restano disponibili e
l’interfaccia segnala che le immagini vanno completate.

L’archiviazione conserva i personaggi e disabilita il controllo da parte dei giocatori.

Permessi e revisioni sono verificati sul server, compresa la revoca durante una modifica.
Un conflitto restituisce 409 e lascia la bozza aperta. L’aggiornamento dei permessi invalida
le revisioni degli editor aperti tramite trigger. I retry di creazione usano ID stabili.
Le letture usano una sessione D1 `first-primary`. Gli account test non possono scrivere.

Scheda, regole, appunti, dadi e zaino restano nel pannello laterale condiviso. In modalità
laboratorio il pannello offre larghezza regolabile, “Tieni aperto”, memoria della scheda
selezionata per avventura e posizione di scorrimento per sezione. Scheda e zaino non salvati
bloccano il cambio di personaggio/sezione finché si salva o si annulla. Le regole sono
ricercabili. Gli appunti storici sono in sola lettura, affiancati da un taccuino locale.
Le pagine attuali mantengono il normale pannello, senza queste opzioni di laboratorio.

Verifiche senza dati remoti:

```bash
node --test functions/api/gdr-workspace/workspace.test.mjs
npm run build
node scripts/smoke-gdr-laboratorio.mjs
node scripts/smoke-gdr-workspace.mjs
node scripts/smoke-gdr-layout.mjs
```

Gli smoke test usano API simulate o i veri handler su SQLite temporaneo: nessuna scrittura
sulle partite o sul database remoto. Tiri collegati ai turni,
notifiche in tempo reale e modalità Alice is Missing rimangono da implementare.

## Database

Le migrazioni sono in `migrations/`:

```bash
npx wrangler d1 migrations apply DB --local
```

Per applicarle al D1 configurato su Cloudflare:

```bash
npx wrangler d1 migrations apply DB --remote
```

Il binding D1 deve chiamarsi `DB`. `WORLD_KEY` deve essere configurata come secret nelle impostazioni del progetto Cloudflare Pages e non deve essere inserita in `wrangler.toml` o nel repository.

## Telemetria

La telemetria usa due endpoint autenticati e non rinnova la durata della sessione:

- `POST /api/telemetry/events`: registra eventi significativi delle diverse sezioni.
- `POST /api/telemetry/word-attempts`: registra i tentativi del cruciverba dopo un secondo di pausa.

La tabella `events` contiene sezione, tipo, versione dello schema, metadati JSON, utente e sessione. Validazione e inserimento SQL sono centralizzati in `recordEvent` dentro `functions/api/_shared/events.js` (`ALLOWED_EVENTS` elenca ogni tipo consentito). Gli eventi che il client può richiedere direttamente devono comparire anche in `CLIENT_EVENT_TYPES` dentro `functions/api/telemetry/events.js`; quelli registrati lato server (dopo una scrittura riuscita, tramite `context.waitUntil`) restano fuori da quella seconda lista apposta, così un client non può fingerli.

Il cruciverba registra `crossword_opened`, `crossword_closed`, `word_completed`, `crossword_completed` e `theme_changed`. La chiusura include durata e progresso, viene inviata una sola volta per apertura e usa una richiesta `keepalive` quando la pagina viene abbandonata.

Il frontend usa `TelemetryService` in `web/src/app/core/telemetry.service.ts`:

- `world_page_opened` parte dalla shell condivisa per le pagine del mondo: sezione derivata dal primo segmento del percorso e path completo nei metadata.
- Cuffiette: `song_played` al click che carica il player SoundCloud (è un iframe di terze parti, non possiamo leggere play/pausa/fine reali — il click è il segnale più vicino disponibile); la traccia bonus, essendo audio nativo, usa invece `play`/`ended` veri per `song_played`/`song_completed`; `playlist_link_clicked` sul link alla playlist esterna.
- Lettere, GDR, Suggerimenti: `letter_sent`, `gdr_turn_submitted`, `gdr_character_saved`, `suggestion_sent` sono registrati lato server subito dopo il salvataggio riuscito, con metadata minimi (es. lunghezza del testo o nome dell'avventura) — mai il testo scritto. Gli appunti GDR restano esclusi apposta: si autosalvano a ogni pausa di scrittura, tracciarli sarebbe rumoroso quanto tracciare i tasti.

I tentativi sono separati in `crossword_word_attempts`. Ogni parola usa come `word_id` il proprio ID nella tabella `crossword_words`. Le celle interne ancora vuote sono rappresentate da `_`; le celle vuote finali vengono omesse. Il frontend evita richieste duplicate e il backend impedisce comunque inserimenti consecutivi identici per utente e parola.

Il backend legge la soluzione da `crossword_words` e calcola accuratezza posizionale, similarità di modifica, completezza e compatibilità complessiva. Un prefisso corretto può quindi avere compatibilità 100% ma completezza inferiore: per esempio `AFFET` rispetto ad `AFFETTO` ha compatibilità 100% ma completezza 71,43%.

La tabella `sessions` resta la fonte ufficiale per autenticazione, scadenza e logout. La cronologia permanente registra invece in `events` le azioni `register`, `login_success`, `world_unlocked` e `logout`; `session_id` viene conservato come riferimento storico senza vincolo esterno, quindi gli eventi sopravvivono anche a una futura rimozione delle sessioni. I metadata auth contengono IP, user agent e, quando applicabile, i 7 giorni di validità.

Prima dell'autenticazione, `POST /api/visits` crea una visita anonima identificata dal cookie casuale `noi_visit`. Nel database viene conservato soltanto l'hash del token, insieme a IP, user agent e contesto Cloudflare. Se successivamente avviene login, registrazione o sblocco, `visit_session_links` collega la visita a utente e sessione; in caso contrario il record anonimo resta comunque disponibile.

## Aspetto del cruciverba

Il cruciverba (`/tavolo-da-gioco/cruciverba`) usa `AppShell`, lo stesso cielo stellato e gli stessi temi delle altre pagine. La UI specifica è suddivisa nei componenti sotto `web/src/app/pages/cruciverba/`; logica, persistenza, sincronizzazione e telemetria vivono nel `CrosswordService`. Il CSS specifico resta `web/src/styles/pages/crossword.css`, caricato direttamente dal componente Angular.

## Struttura delle pagine Angular

Le route lazy sono dichiarate in `web/src/app/app.routes.ts`. Ogni pagina usa `AppShell` per header, userbar, temi e logout; i contenuti vivono in `web/src/app/pages/`, mentre servizi e componenti trasversali sono in `web/src/app/core/` e `web/src/app/shared/`. Il vecchio sistema di template e gli HTML generati sono congelati in `legacy-archive/` e non fanno parte della build.

Bottoni e card hanno classi condivise in `web/src/styles/components/buttons.css` (`.btn`, con i modifier `.btn-accent` per il colore oro ricorrente e `.btn-submit` per i bottoni di invio nei form) e `web/src/styles/components/cards.css` (`.card` per il pannello "frost" scuro, `.card--compact` per le righe di lista, `.card--paper` per l'inserto a foglio chiaro usato in Calendario e Mappamondo, `.card--dialog` per le finestre modali).

Il selettore tema (Night Sky/Ocean/Velvet/Red of You/Green of Me) vive in Impostazioni del Mondo ed è gestito da `ThemeService`. La scelta è condivisa tramite `world_settings`; `localStorage` conserva l'ultimo valore noto per applicarlo prima del primo paint. Cambia subito `--focus-color` e il tint del cielo stellato.

## Progresso persistente

Ogni parola vive in `crossword_words` con ID, soluzione, definizione, coordinate, direzione e posizione. Lo stato del singolo utente resta separato in `crossword_answers`.

- `GET /api/crossword/answers`: recupera tutte le risposte dell'utente autenticato.
- `PUT /api/crossword/answers/:wordId`: aggiorna una singola risposta tramite UPSERT.

Il backend legge la soluzione da `crossword_words` e calcola autonomamente `is_completed` e `completed_at`. Il frontend sincronizza dopo un secondo di pausa, evita valori duplicati e mantiene `localStorage` come fallback. Se il database è ancora vuoto, il progresso locale esistente viene trasferito automaticamente al primo caricamento.

## Proposte per Le Storie

La pagina `storie/` permette all'utente autenticato di lasciare una storia completa oppure un'idea da sviluppare. Il form accetta un titolo facoltativo, il testo, indicazioni sulla musica e indicazioni sulle immagini desiderate; non carica file e non pubblica automaticamente il contenuto.

`POST /api/stories/suggestions` ricava l'autore dalla sessione e assegna la data sul server. Le proposte vengono conservate in `story_suggestions` con stato iniziale `pending`, così possono essere revisionate prima di entrare nella raccolta pubblicata.

## Suggerimenti liberi

La pagina `suggerimenti/` permette all'utente autenticato di proporre qualunque idea per il Mondo Bianco, con una categoria obbligatoria (dove si vorrebbe applicare la modifica: Calendario, Mappa, Storie, Cuffiette, Bacheca, Ponti, Lettere, Tavolo da Gioco o Altro), un titolo facoltativo e un messaggio libero. È raggiungibile dal bottone "Suggerisci" nella pagina 404 interna.

`POST /api/suggestions` ricava l'autore dalla sessione, valida la categoria contro un elenco fisso (`CATEGORIES` in `functions/api/suggestions.js`) e conserva la proposta in `world_suggestions` con stato iniziale `pending`, sullo stesso modello delle proposte per Le Storie.

## Lettere

La pagina `lettere/` sostituisce l'idea originale della Cassetta delle Lettere (un upload manuale su Drive, necessario quando non si poteva chattare normalmente): ora che la comunicazione quotidiana passa da WhatsApp, resta solo il bisogno di lasciarsi un messaggio più lungo e pensato. Chi scrive compone solo testo (nessun allegato per ora); la lettura avviene in una vista dedicata in stile foglio di carta, corsivo, firmata con il nickname dell'autore.

Con soli due account non serve indicare un destinatario: `letters` in D1 conserva autore, testo, data e `read_at`; chi non ha scritto la lettera è per definizione chi la riceve. `GET /api/letters` elenca tutte le lettere con `isMine` calcolato lato server; `POST /api/letters` ne crea una nuova; `POST /api/letters/:id` la segna come letta, ma solo se chi la apre non ne è l'autore. Non è ancora raggiungibile dall'hub principale, per lo stesso motivo dei Suggerimenti: non è uno degli otto luoghi originali del Mondo Bianco.

## Il Prezzo della Verità

L'avventura del Gioco di Ruolo era finora un link esterno a un documento Google usato come "play-by-chat" manuale. Rory ha fornito l'export HTML dei 3 documenti originali (L'Avventura, La Tua Maga, I Tuoi Appunti) più le immagini dei personaggi; ora vivono dentro il sito, in `tavolo-da-gioco/gdr/il-prezzo-della-verita/`:

- `avventura/` — l'incipit completo (mondo, scuola, backstory, i 5 NPC con ritratto) fino all'apertura di Atto I, seguito da un vero thread di gioco: chi legge e il master scrivono i turni in ordine cronologico, salvati in D1 (`gdr_turns`, uno per avventura, condiviso tra i due account) tramite `GET`/`POST /api/gdr/turns`. I ritratti sono immagini pubbliche statiche in `web/public/assets/images/gdr/il-prezzo-della-verita/` (arte decorativa generata, non media personale, quindi niente `/api/media/`).
- `la-tua-maga/` — la scheda personaggio, compilabile: nome, gatta, descrizione, statistiche (Mente/Cuore/Corpo/Magia), Punti Stress, slot magia e inventario si salvano in D1 (`gdr_characters`, uno per utente per avventura) tramite `GET`/`POST /api/gdr/character`. Le parti fisse del regolamento (abilità speciali, elenco incantesimi, tabella "Effetti Selvaggi") restano testo di riferimento.
- `i-tuoi-appunti/` — un blocco note reale, salvato in D1 (`gdr_notes`, uno per utente per avventura) tramite `GET`/`POST /api/gdr/notes`, non in localStorage.

Le tre pagine sono collegate da una barra di pillole in cima (`.ipdv-nav`, stesso pattern dell'indice della Bacheca) invece che solo da link in mezzo al testo o da una sidebar fissa.

## Giochi condivisi

Dal Tavolo da Gioco, tre ingressi portano a pagine indipendenti, senza collegamenti incrociati:

- `/tavolo-da-gioco/trappole`: griglia 5×5, sei trappole, 12 energia, bandierine e una sonda gratuita su una casella vicina. Primo ingresso su una trappola: costo 3; altri passi: costo 1. Le nuove mappe devono avere una strada sicura di massimo 10 passi. Restano le ultime 30 sfide, con replay del percorso. Le sfide precedenti mantengono le regole originali (18 energia).
- `/tavolo-da-gioco/frequenze`: otto famiglie di puzzle cooperativi, selezionabili singolarmente o in una partita mista da 3, 5 o 8 prove, con difficoltà facile/normale/difficile. I ruoli si alternano; entrambi devono entrare dai propri account. Sono conservate la partita in corso e le ultime 20 partite precedenti. Gli admin trovano **Prova da solo**: gli stessi componenti di gioco in due pannelli controllabili in `/tavolo-da-gioco/frequenze/prova`, con stato separato per admin (`practice:<id>`) e reset esclusivamente della prova. Il vecchio formato a tre serrature rimane giocabile fino al termine; le nuove stanze usano lo schema JSON 2 senza migrazioni SQL aggiuntive.
- `/tavolo-da-gioco/animali`: casa e salvadanaio condivisi, sei specie (gatto, cane, volpe, coniglio, papera, istrice), uova scelte o a sorpresa. Il primo uovo è gratuito, le tre azioni di incubazione lo fanno schiudere; le adozioni successive costano 60 monete e richiedono 18 XP totali per ogni animale già presente. Un uovo in incubazione alla volta, massimo 12 animali. La sorpresa preferisce specie mancanti. I cuccioli crescono di dimensioni fino a 18 XP, senza cambiare disegno.

Gli animali hanno proposte di nome indipendenti per i due utenti: l’altro approva una proposta ancora valida. Il portafoglio parte da 30 monete, senza premi basati sul tempo. Il memory condiviso (12 carte) assegna 4–16 monete secondo i tentativi e 3 XP all’animale selezionato, soltanto al completamento. Carte, accoppiamenti e premio sono verificati dal server; una partita incompleta si riprende anche dall’altro account. Lo shop vende giochi interattivi (scatola, pallina, tunnel, vaschetta), decorazioni e spuntini consumabili. Due giochi possono essere posizionati nella stanza; le reazioni e le preferenze si scoprono usandoli.

Le cure e le interazioni assegnano +1 XP per animale, utente e attività al giorno (Europe/Rome); ripeterle resta possibile senza XP aggiuntivi. Nessun decadimento o penalità per assenza. Nessun legame con bustine, altre valute o premi degli altri giochi. La vecchia route `/piccole-avventure?gioco=...` resta compatibile. Il vecchio Nuvola viene convertito nello schema JSON 2 alla prima azione, conservando nome, XP, decorazioni e cure giornaliere: non serve una nuova migrazione SQL.

La migrazione **`0124_add_giochi_due.sql` va applicata prima del rilascio**. Lo stato D1 è separato per coppia di utenti e attività; la coppia segue la stessa selezione del partner delle carte. Gli account di prova non accedono a queste attività condivise. Le azioni usano versioni e identificativi di richiesta per evitare sovrascritture e doppi invii. La pagina si aggiorna ogni tre secondi soltanto quando visibile; non richiede modifiche al Worker realtime. Gli indizi segreti non sono inclusi nelle risposte API dell’altro ruolo.

Verifiche: `npm run test:giochi-due`; dopo `npm run build`, `node scripts/smoke-giochi-due.mjs` prova due sessioni browser contro l’handler API e SQLite in memoria, senza dati di produzione. Verifica le otto famiglie cooperative, la prova admin isolata, uovo/schiusa, proposte di nome, acquisti, premio del memory, persistenza e layout mobile. Genera schermate in una directory temporanea. Non sono inclusi popup promozionali, premi incrociati o il gioco di riordino dei cosmetici.

### Sulla stessa frequenza: prove e regole

#### Stanza sperimentale: Uno dentro, uno fuori

Dal riquadro dedicato si può aprire **Il marchingegno** scegliendo «Io sto fuori» oppure «Io entro nella scatola». La stanza non entra nei giri misti e non finge di avere tre difficoltà: è un singolo allestimento progettato per provare un nuovo tipo di cooperazione. Si può ripetere e scambiare i ruoli, ma non è ancora un’avventura procedurale.

Le nuove stanze usano `mechanics: 2`: fuori ci sono una manovella, una cinghia spostabile fra due ruote, un cassetto con l’ingranaggio mancante alla bobina e il chiavistello finale. Dentro c’è Pip, con piattaforma mobile, scala da srotolare, leva della frizione, culla di rame e una sfera ingombrante. La leva interna allenta la trasmissione e libera il cassetto esterno: fuori si sceglie e si monta il collegamento, dentro lo si rimette in presa. La piattaforma può trasportare Pip oppure la sfera, mai entrambi. Alla fine anche chi è fuori deve liberare l’uscita. Le partite salvate senza `mechanics: 2` mantengono le regole originali fino al completamento; non vengono convertite a metà.

Le interazioni sono sugli oggetti della scena, senza pulsanti descrittivi sotto al disegno: cinghia, ingranaggio e sfera si trascinano o si selezionano e poi si tocca la destinazione; la manovella accetta rotazione trascinata oppure un tocco sui due lati. I ripiani sono le destinazioni di Pip. Le aree interattive sono raggiungibili anche da tastiera, hanno etichette accessibili e non evidenziano anticipatamente la destinazione corretta. Escape annulla una selezione. I suoni/reazioni testuali sono consultabili aprendo «Cosa si sente?» e annunciati ai lettori di schermo. Tre suggerimenti sono disponibili soltanto su richiesta. Nessuna penalità, timer o requisito di riflessi. Resta una stanza artigianale, non un gioco rigiocabile all’infinito.

Le viste API restano distinte: l’esterno non riceve la posizione di Pip o il contenuto della stanza; l’interno non riceve i comandi esterni. Il server valida ogni comando e conserva lo stato nel JSON esistente, senza nuove migrazioni. La sincronizzazione passa a un secondo solo mentre questa stanza è attiva e visibile; gli altri giochi restano a tre secondi. La modalità admin usa gli stessi due punti di vista e permette anche di invertire i ruoli.

`machine.test.mjs` esplora tutti gli stati raggiungibili e verifica che ognuno consenta ancora di raggiungere l’uscita senza reset, oltre a privacy, ruoli, salvataggio e completamento. Lo smoke browser completa la stanza con due account e poi in admin con ruoli invertiti, controlla gli schermi a 320/390 px e conserva screenshot. È una prova di funzionamento, non una valutazione automatica di quanto il gioco sia divertente.

| Prova | Cosa fate | Informazioni e comandi separati |
| --- | --- | --- |
| 🔐 Il codice | Traducete quattro simboli in numeri; resta il riscaldamento facile. | Uno ha la sequenza, l’altro la legenda e conferma di essere pronto. |
| 🧭 Mappa a metà | Raccogliete le chiavi e raggiungete l’uscita su mappe 4×4, 5×5 o 6×6. | Uno vede i passaggi orizzontali, l’altro quelli verticali. Movimento alternato a ogni passo. |
| 💡 Corto circuito | Invertite gruppi di lampadine fino a raggiungere tutti gli stati richiesti. | Ognuno controlla metà interruttori e vede metà lampadine; gli effetti attraversano i due pannelli. |
| 📚 Tutto in fila | Riordinate 4–6 oggetti; a difficile entrano distanze, adiacenze, estremità e posizioni escluse, oltre alle precedenze. | Indizi privati diversi, fila comune e conferma di entrambi. |
| 🔎 Il caso degli otto | Identificate il sospetto compatibile con le testimonianze. | Ogni metà lascia più candidati; solo l’incrocio identifica una persona. Voti indipendenti. |
| 🎨 Pixel in incognito | Risolvete un nonogram 3×3, 4×4 o 5×5. | Uno legge le righe, l’altro le colonne; ciascuno può modificare solo le proprie celle a scacchiera. |
| ⚖️ Questione di peso | Scegliete due pesi a testa per ottenere il totale richiesto. | Pesi e subtotali privati, conteggio delle selezioni comune, verifica bilaterale. |
| 🔌 Circuito spezzato | Ruotate tubi su una griglia 3×3, 4×4 o 5×5 per collegare ingresso e uscita. | Tubi visibili e controllabili a scacchiera. Sono accettati tutti i percorsi validi, non solo quello generato. |

Le partite miste da 3 o 5 prove estraggono famiglie diverse fra i sette nuovi giochi; il giro da 8 le include tutte, iniziando dal codice. Ogni prova ha tre suggerimenti graduali condivisi. Un nuovo schema della stessa famiglia richiede il consenso di entrambi e non azzera errori, azioni, aiuti o tempo già impiegato. Anche il passaggio alla prova successiva richiede entrambi; ogni modifica a fila/mosaico/pesi/tubi annulla le conferme precedenti. Non ci sono timer punitivi, ricompense basate sul tempo o collegamenti con gli altri giochi.

Il riepilogo conserva per ogni prova errori, aiuti, azioni e durata trascorsa (comprende eventuali pause); non è un punteggio competitivo. L’ultima partita resta visibile e viene archiviata quando se ne apre un’altra. I generatori partono da configurazioni risolvibili, con controlli di unicità e tentativi limitati dove necessari. Nel codice server restano soluzioni, mappa completa e indizi dell’altro; i DTO espongono solo campi autorizzati. Ogni comando include identificativo stanza/prova e versione; le richieste obsolete sono rifiutate senza sovrascrivere il progresso. La prova admin usa gli stessi controlli della partita reale, non un simulatore diverso.

### Ricerca di riferimento per il cooperativo — 21 ottobre 2026

Ricerca svolta con tre agenti su videogiochi asimmetrici e giochi da tavolo: **24 titoli di riferimento**, non una pretesa di censire ogni gioco esistente. Le implementazioni sopra sono puzzle originali basati su meccaniche generali: nessun asset, testo, livello o regolamento commerciale è stato copiato integralmente. Le seguenti sono fonti degli autori/editori o relative pagine ufficiali di distribuzione.

| Riferimento | Spunto analizzato |
| --- | --- |
| [Keep Talking and Nobody Explodes](https://keeptalkinggame.com/) | Informazioni separate e moduli con procedure differenti. |
| [We Were Here](https://totalmayhemgames.com/games/we-were-here/) | Descrivere ambienti e indizi che l’altro non vede. |
| [We Were Here Expeditions](https://support.totalmayhemgames.com/hc/en-us/articles/23286195951773-I-lost-my-progress-I-need-to-select-a-checkpoint-in-We-Were-Here-Expeditions) | Cooperazione suddivisa in prove e checkpoint. |
| [Tick Tock: A Tale for Two](https://www.ticktockthegame.com/support) | Due dispositivi, informazioni complementari e comunicazione libera. |
| [The Past Within](https://store.steampowered.com/app/1515210/The_Past_Within/) | Due prospettive diverse dello stesso mistero. |
| [Operation: Tango](https://www.nintendo.com/us/store/products/operation-tango-switch/) | Ruoli con strumenti e azioni differenti. |
| [Unsolved Case](https://elevenpuzzles.com/unsolved-case/) | Problemi condivisi con porzioni di indizi e oggetti private. |
| [Unboxing the Cryptic Killer](https://store.steampowered.com/app/2069040/Unboxing_the_Cryptic_Killer/) | Varietà di enigmi e schermi complementari. |
| [Parallel Experiment](https://store.steampowered.com/app/2012320/Parallel_Experiment/) | Interdipendenza fra azioni dei due investigatori. |
| [BOKURA](https://creatorslab.kodansha.co.jp/en/products/1275/) | Percezioni diverse dello stesso spazio. |
| [In Sink](https://www.insinkgame.com/) | Leve, pulsanti, bilance e strumenti non solo testuali. |
| [How 2 Escape](https://store.steampowered.com/app/2264140/How_2_Escape/) | Chi agisce dipende dalle informazioni del compagno. |
| [The Timeless Child](https://store.steampowered.com/app/1792010/The_Timeless_Child__Prologue/) | Collaborazione fra prospettive temporali. |
| [Hanabi](https://www.cocktailgames.com/jeu/hanabi/) | Gestione degli indizi e informazioni sulle mani altrui. |
| [Codenames Duet](https://www.czechgames.com/for-press-games/codenames-duet) | Obiettivi privati e indizi condivisi. |
| [Bomb Busters](https://www.cocktailgames.com/jeu/bomb-busters/) | Deduzione numerica sulle informazioni nascoste. |
| [Sky Team](https://www.scorpionmasque.com/en/sky-team) | Controlli separati e decisioni che influenzano lo stesso sistema. |
| [The Crew: Mission Deep Sea](https://www.thamesandkosmos.co.uk/product/the-crew-mission-deep-sea/) | Compiti cooperativi e comunicazione limitata. |
| [The Fox in the Forest Duet](https://renegadegamestudios.com/fox-in-the-forest-duet/) | Coordinare il movimento condiviso attraverso decisioni individuali. |
| [The Shipwreck Arcana](https://www.meromorphgames.com/shop/shipwreck-arcana) | Ridurre possibilità tramite vincoli logici. |
| [Letter Jam](https://www.czechgames.com/games/letter-jam) | Indizi che aiutano altri a ricostruire informazioni invisibili. |
| [Décorum](https://floodgate.games/products/decorum) | Un’unica disposizione che soddisfa vincoli privati diversi. |
| [Perspectives](https://www.spacecowboys-games.com/fr/game/perspectives/) | Ricostruzione di un caso tramite osservazioni distribuite. |
| [Turing Machine](https://www.scorpionmasque.com/en/turingmachine) | Deduzione mediante verifiche logiche; non nasce come gioco asimmetrico, ma prevede anche la variante cooperativa. |

Scelta progettuale: distribuire **anche i controlli**, alternare ragionamento spaziale, numerico e deduttivo, consentire tentativi senza perdere la partita e generare schemi nuovi. Non sono stati implementati cloni completi di questi titoli. Sono rimandati giochi di prese/carte, indizi linguistici con grandi dizionari, avventure narrative persistenti e sfide di precisione in tempo reale: richiedono rispettivamente un altro motore, contenuti editoriali o una sincronizzazione diversa dall’attuale polling. Le otto famiglie hanno regole verificabili sul server e non richiedono servizi AI durante la partita.

## Redirect legacy

`web/public/_redirects` fa da ponte con i vecchi short link `rsgmsfcfm.short.gy/<slug>` dell'export originale: ogni slug (`il-calendario`, `la-mappa`, `la-bacheca`, ecc.) reindirizza con 301 alla route Angular corrispondente. Short.gy resta un servizio esterno: per usare questi alias bisogna aggiornare manualmente ogni short link perché punti a `https://<dominio>/<slug>` invece del vecchio URL Notion.

## Pagina 404

Le route sconosciute sono gestite dalla route wildcard Angular, che mostra la pagina 404 interna e mantiene i collegamenti al Mondo Bianco e ai suggerimenti. Il fallback SPA di Cloudflare Pages serve `index.html` anche sugli URL sconosciuti; la vecchia `404.html` resta in `legacy-archive/` soltanto come riferimento reversibile.

## Pubblicazione

**Per questo progetto si pubblica esclusivamente tramite GitHub.** Cloudflare Pages esegue automaticamente la build del codice inviato a `main`. Non eseguire pubblicazioni dirette su Cloudflare, né dal computer né dal pannello: includerebbero potenzialmente modifiche assenti da GitHub, che una pubblicazione successiva potrebbe cancellare dal sito.

Iter obbligatorio per ogni rilascio:

1. Recuperare le modifiche da GitHub e integrare quelle remote senza perdere il lavoro locale.
2. Verificare le modifiche ed eseguire build e controlli pertinenti.
3. Se necessarie, verificare e applicare le migrazioni al database remoto nell’ordine richiesto, prima del codice che ne dipende.
4. Registrare in Git tutte le modifiche del rilascio, compresi nuovi file e migrazioni, e inviarle su GitHub nel branch `main`.
5. Attendere la pubblicazione automatica e verificare che `/build-version.json` sul sito riporti il commit inviato, quindi controllare le funzionalità interessate.

Le build pubblicano il commit con cui sono state avviate, non il contenuto corrente di `main`. Riavviare una build storica può quindi sostituire il sito con codice precedente, anche se GitHub è aggiornato. Non riprovare rilasci di commit superati: inviare la correzione su `main` e attendere la build di quel commit. Prima di intervenire su una build, confrontare il suo SHA con `origin/main`.

Quando più chat lavorano contemporaneamente, possono preparare modifiche separate, ma occorre coordinare il rilascio: una sola attività segue la pubblicazione fino alla verifica online. Il workflow di notifica segnala la versione pubblicata; non serializza né annulla le build di Cloudflare Pages. Al termine rimuovere le copie di lavoro temporanee solo dopo aver verificato che non contengano modifiche o commit da recuperare.

Il rilascio non è concluso finché il codice pubblicato non è presente su GitHub e la versione online non coincide con il commit atteso. Non usare un deploy diretto come scorciatoia se la build automatica fallisce: correggere il problema e inviare la correzione su GitHub.


Collega il repository GitHub a Cloudflare Pages usando `npm run build` come comando di build e `web/dist/web/browser` come directory di output. Prima del primo utilizzo:

1. collega il database D1 al binding `DB`;
2. configura il secret `WORLD_KEY`;
3. applica le migrazioni al database remoto;
4. esegui un nuovo deployment.

### Avviso di nuova versione in diretta

La build aggiunge `CF_PAGES_COMMIT_SHA` all'HTML e a `/build-version.json`. Dopo ogni push su
`main`, il workflow `.github/workflows/notify-deployment.yml` aspetta che quel commit sia davvero
servito da `https://il-mondo-bianco.com`, quindi chiama `POST /api/deploy-notify`: la Function
verifica a sua volta che il commit coincida con `/build-version.json`, pubblica
`site-version:changed` sul canale realtime e i client della vecchia build mostrano subito “Ho
aggiornato il Mondo Bianco”. L'endpoint non richiede secret perché può annunciare soltanto una
versione realmente online; eventi ripetuti vengono ignorati dal client. Il controllo HTTP ogni
cinque minuti e al ritorno sulla scheda resta attivo come fallback.

GitHub Pages da solo non può eseguire l'autenticazione, le Pages Functions o D1.

## Realtime passivo

L'infrastruttura WebSocket è predisposta e collegata ai flussi selezionati, ma rimane passiva
finché Worker e binding non vengono pubblicati.
Il Worker separato `the-white-world-realtime` ospita il Durable Object SQLite-backed
`RealtimeRoom`; Pages espone `/api/realtime`, autenticato con la sessione esistente, e Angular
dispone di `RealtimeService`. L'app lo avvia solo se l'endpoint conferma che il binding è attivo.

Le API REST e D1 restano la fonte ufficiale. Quando un flusso verrà abilitato, la relativa
Function potrà chiamare `notifyRealtime()` soltanto dopo il salvataggio riuscito e il browser
ricevente usera' l'evento come segnale per ricaricare i dati tramite il normale endpoint GET.

Sono già collegati al canale, ma restano inattivi finché manca il binding: Ponti Chat (nuovi
messaggi, eliminazioni e letture), Stranger Chat, i turni delle due avventure GDR, Lettere
(invio e lettura), proposte/risposte agli scambi di carte e Impostazioni del Mondo condivise.
L'evento contiene l'utente che ha originato la modifica, così la sua stessa scheda non esegue
un secondo caricamento ridondante.

Lo stesso socket gestisce la presenza della Chat globale. Il browser invia soltanto route e
visibilità su connessione, navigazione e `visibilitychange`; il Durable Object aggrega le schede
per identità e separa account principali da account test. Una scheda in background non conta come
online. L'ultima visita è conservata nello storage del Durable Object e il widget mostra pagina
corrente o data dell'ultima visita senza introdurre heartbeat o polling.

Per validare e pubblicare il Worker:

```bash
npm run check:realtime
npm run deploy:realtime
```

Il binding Pages è configurato sia per l'ambiente principale sia per `env.production`:

```toml
[[durable_objects.bindings]]
name = "REALTIME"
class_name = "RealtimeRoom"
script_name = "the-white-world-realtime"
```

Se il binding non è disponibile, `/api/realtime` risponde intenzionalmente con `503` e il resto
del sito non è coinvolto. Lo sviluppo locale completo richiede due terminali:
`npm run dev:realtime` e, dopo la build, `npm run dev:api:realtime`; Angular continua a usare
il normale `npm start`.

## Analisi dell'export originale

L'export Notion resta immutato e viene analizzato senza dipendenze aggiuntive:

```bash
npm run analyze:export
npm run verify:links
```

I testi puliti delle pagine vengono salvati e versionati in `sources/notion-original/`, così restano disponibili senza essere pubblicati insieme all'app. Inventario tecnico, verifica dei collegamenti e riepilogo leggibile sono conservati in `sources/migration-reports/`; il manifest operativo della Bacheca si trova in `sources/manifests/`.

## File principali

- `functions/api/crossword-words/`: gestione amministrativa di parole, definizioni, coordinate e ordine del Cruciverba.
- `web/src/app/portone/`: Portone e interfaccia di autenticazione.
- `web/src/app/pages/`: pagine lazy del Mondo Bianco.
- `web/src/styles/themes.css`: variabili e temi condivisi dalla piattaforma.
- `web/src/styles/components/`: primitive CSS condivise, come shell, accesso, bottoni e form.
- `web/src/styles/pages/`: stile specifico delle singole pagine e dei luoghi.
- `web/public/content/`: raccolte statiche pubbliche ordinate direttamente dalla posizione nell'array.
- `sources/`: fonti originali, immagini sostituite, report di migrazione e manifest non pubblicati.
- `scripts/build-music-content.mjs`: ricostruisce i nove brani e le citazioni delle Cuffiette dalla fonte originale congelata, senza correggerne il testo.
- `web/src/app/pages/cruciverba/`: componenti e servizio del cruciverba.
- `web/src/app/core/`, `web/src/app/shared/`: autenticazione, API, navigazione, visite, temi e UI condivisa.
- `functions/api/auth/`: API di registrazione, login e sessione.
- `functions/api/crossword/`: API dello stato persistente del cruciverba.
- `functions/api/telemetry/`: eventi generali e cronologia dei tentativi.
- `functions/api/stories/`: ricezione autenticata delle proposte per nuove storie.
- `functions/api/suggestions.js`: ricezione autenticata dei suggerimenti liberi per il Mondo Bianco.
- `functions/api/letters.js`, `functions/api/letters/[id].js`: elenco/scrittura delle lettere e conferma di lettura.
- `functions/api/gdr/notes.js`: lettura/salvataggio del blocco appunti personale per le avventure del Gioco di Ruolo.
- `functions/api/gdr/character.js`: lettura/salvataggio della scheda personaggio compilabile.
- `functions/api/gdr/turns.js`: lettura/scrittura del thread di gioco condiviso (i turni del play-by-chat).
- `web/src/app/pages/{gdr,il-prezzo-della-verita,avventura,la-tua-maga,i-tuoi-appunti}/`: hub e pagine dell'avventura.
- `functions/api/media/[[path]].js`: accesso autenticato ai media privati conservati in R2.
- `functions/api/bacheca-periods/`, `functions/api/bacheca-days/`, `functions/api/bacheca-media/`: contenuti modificabili e upload R2 della Bacheca.
- `scripts/optimize-world-images.mjs`: converte in WebP (qualità 82, tramite `sharp`) le immagini hero/decorative pubbliche (`web/public/assets/images/world/`, `web/public/assets/images/gdr/`), lasciando intatti gli originali PNG/JPG accanto al file ottimizzato. Idempotente: si può rilanciare in sicurezza dopo aver aggiunto nuove immagini in quelle cartelle.
- `legacy-archive/`: frontend vanilla congelato e non pubblicato, mantenuto temporaneamente per confronti e rollback.
- `web/public/_redirects`: alias verso le nuove route per i vecchi short link controllabili.
- `migrations/`: schema D1 per utenti, sessioni, IP di accesso e telemetria.
- `wrangler.toml`: configurazione Cloudflare e binding D1.
- `final-message.json`: contenuto della schermata finale.

### Safe mode

Preferenza personale persistita in `users.safe_mode`, modificabile all’ingresso e dalla barra utente. L’interruttore all’ingresso cambia subito la presentazione: safe essenziale o Portone completo. Se la sessione identifica già l’account, carica e salva subito la preferenza; prima dell’identificazione mantiene neutro l’ingresso e conserva la scelta esplicita per il login. La modalità non modifica tema o effetti condivisi. Attivarla spegne la modalità admin per tutte le sessioni dello stesso utente; disattivarla non riaccende l’admin.

La lista delle destinazioni consentite vive in `web/src/app/core/safe-mode.service.ts`: home, profilo, novità, chat normale, Aula studio e quiz, Tavolo da Gioco, Trappole, Frequenze, Casa degli animali e GDR con tutte le sue sottopagine. Le altre pagine vengono nascoste e i collegamenti diretti riportano alla home. La chat globale e la sua pagina restano disponibili. Promozioni, ricompense delle carte e contenuti sentimentali della home non compaiono.

Ogni novità ha il tag Safe nell’editor admin. Le voci esistenti e quelle create automaticamente sono non safe per impostazione predefinita; `addWorldUpdate` accetta `safe: true` per contenuti verificati. Il filtro viene applicato anche dal server e dal popup. Le novità nascoste non vengono segnate come lette.

Prima di distribuire il frontend applicare la migrazione `0139_add_safe_mode.sql`, che aggiunge anche `world_updates.safe`. Verifica locale: `npm run build` e `npm run test:safe-mode` (API con SQLite in memoria e browser con risposte simulate; nessun dato remoto).

### Email delle Novità

Pubblicare un nuovo seguito come master in un’avventura GDR pubblicata crea automaticamente una Novità con titolo e collegamento alla partita, senza riportare il racconto nell’avviso. L’email usa la coda e le impostazioni esistenti. Risposte della giocatrice, bozze, account test, impersonazione e modifiche o eliminazioni di turni già pubblicati non generano nuove Novità.

Le nuove voci in `world_updates` entrano nella coda `world_update_emails`: solo se attive, con `announce=1` e data di pubblicazione raggiunta possono essere inviate all’altra identità. L’abilitazione admin `admin_email_updates=1` forza l’invio indipendentemente dalla preferenza email personale e dalla modalità Safe; senza override servono la preferenza personale attiva e la compatibilità con Safe. Il filtro Safe delle pagine e dei popup resta autonomo rispetto alle email. Gli account test sono esclusi anche dagli invii forzati. I normali commit e le correzioni a voci già inviate non generano email. L’archivio precedente all’attivazione della coda non viene notificato retroattivamente. Le voci con stato `skipped` restano escluse finché non vengono esplicitamente rimesse in coda: attivare l’override non recupera automaticamente gli invii precedenti.

Creazione, aggiornamento e lettura delle Novità, aggiunte automatiche di contenuti e conferma di un nuovo rilascio elaborano la coda. Una voce futura viene elaborata alla prima di queste attività dopo la sua data, senza un timer indipendente. Gli errori temporanei restano in coda; un claim atomico e la chiave di idempotenza del provider evitano invii concorrenti. Dopo 23 ore dal primo tentativo, un invio ancora incerto passa a `review` per controllo manuale, senza riprovare oltre la finestra di deduplicazione del provider. `sent` indica l’accettazione da parte del servizio email, non la lettura o la consegna nella posta in arrivo.
