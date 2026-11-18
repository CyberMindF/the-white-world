export type WorldPlaceGroup = 'ricordi' | 'insieme' | 'giochi' | 'mondo';
export type HomeAreaId = 'valle' | 'giardino' | 'prato' | 'osservatorio';

export interface WorldPlace {
  id: string;
  emoji: string;
  route: string | null;
  fallbackName: string;
  fallbackDescription: string;
  group: WorldPlaceGroup;
  primary?: boolean;
  parentId?: string;
  homeArea?: HomeAreaId;
  tagline?: string;
}

// I 4 macro-luoghi della home (riorganizzazione del 15/08/2026): raggruppano le destinazioni
// destinazioni "primary" di WORLD_PLACES sotto card esplorabili, senza introdurre nuove rotte.
export const HOME_AREAS: readonly { id: HomeAreaId; emoji: string; label: string; description: string }[] = [
  { id: 'valle', emoji: '🏞️', label: 'La Valle dei Ricordi', description: 'Il luogo che conserva e racconta le nostre storie' },
  { id: 'giardino', emoji: '🌳', label: 'Il Giardino dei Pensieri', description: 'Il luogo della comunicazione e dell\'esserci sempre' },
  { id: 'prato', emoji: '🌾', label: 'Il Prato delle Idee', description: 'Il luogo dove teniamo tutte le nostre idee e i nostri piani futuri' },
  { id: 'osservatorio', emoji: '🔭', label: 'L’Osservatorio', description: 'il luogo dove si può controllare e osservare il mondo' }
];

export const WORLD_PLACE_GROUPS: readonly { id: WorldPlaceGroup; label: string; description: string }[] = [
  { id: 'ricordi', label: 'Per ritrovare noi', description: 'Ricordi, parole e pezzi della nostra storia' },
  { id: 'insieme', label: 'Per immaginare il dopo', description: 'Idee, mete e cose ancora da vivere' },
  { id: 'giochi', label: 'Per giocare', description: 'Piccole sfide e avventure da attraversare insieme' },
  { id: 'mondo', label: 'Per cambiare il mondo', description: 'Il cielo, il suo aspetto e gli spazi personali' }
];

// Registro funzionale condiviso da home e atlante. Rotte, disponibilità e icone vivono qui;
// nomi e descrizioni delle destinazioni principali possono essere sovrascritti dal CMS.
export const WORLD_PLACES: readonly WorldPlace[] = [
  { id: 'bacheca', emoji: '📸', route: '/bacheca', fallbackName: 'La Bacheca dei Ricordi', fallbackDescription: 'Il nostro album dei ricordi', group: 'ricordi', primary: true, homeArea: 'valle' },
  { id: 'mappamondo', emoji: '🌍', route: '/mappamondo', fallbackName: 'Il Mappamondo', fallbackDescription: 'Come ho immaginato la tua prima volta qui e anche un posto per orientarti', group: 'ricordi', primary: true, homeArea: 'valle' },
  { id: 'ponti', emoji: '🌈', route: '/ponti', fallbackName: 'I Ponti', fallbackDescription: 'I nostri modi per rimanere sempre in contatto, così che non possiamo perderci', group: 'ricordi', primary: true, homeArea: 'giardino' },
  { id: 'chat', emoji: '💬', route: '/ponti-chat', fallbackName: 'Chat', fallbackDescription: 'Uno spazio per scriverci, anche con foto e video.', group: 'ricordi', parentId: 'ponti' },
  { id: 'storie', emoji: '📖', route: '/storie', fallbackName: 'Le Storie', fallbackDescription: 'Un posto dove ci sono storie che parlano di noi dentro questo mondo', group: 'ricordi', primary: true, homeArea: 'valle' },
  { id: 'calendario', emoji: '📅', route: '/calendario', fallbackName: 'Il Calendario', fallbackDescription: 'Tutte le nostre date che hanno avuto importanza', group: 'ricordi', primary: true, homeArea: 'valle' },
  { id: 'cuffiette', emoji: '🎧', route: '/cuffiette', fallbackName: 'Le Cuffiette', fallbackDescription: 'Le canzoni che ho scritto per te e quelle che ho ascoltato pensandoti', group: 'ricordi', primary: true, homeArea: 'valle' },
  { id: 'lettere', emoji: '📫', route: '/lettere', fallbackName: 'La Cassetta delle Lettere', fallbackDescription: 'Un posto dove lasciarci qualche biglietto', group: 'ricordi', primary: true, homeArea: 'giardino' },
  { id: 'domande', emoji: '⛲', route: '/domande', fallbackName: 'Il Pozzo dei Dubbi', fallbackDescription: 'Quando abbiamo una domanda possiamo lasciarla qui e magari troverà risposta', group: 'ricordi', primary: true, homeArea: 'giardino' },
  { id: 'barattolo-dei-pensieri', emoji: '🫙', route: '/barattolo-dei-pensieri', fallbackName: 'Il Barattolo dei Pensieri', fallbackDescription: 'Per quando hai bisogno di una piccola frase da parte mia, qui puoi pescarne una a caso e tentare la fortuna: potrebbe essere un pensiero, un ricordo o una cosa che amo di te', group: 'ricordi', primary: true, homeArea: 'giardino' },
  { id: 'capsula-del-tempo', emoji: '⏳', route: '/capsula-del-tempo', fallbackName: 'La Capsula del Tempo', fallbackDescription: 'Un luogo dove mandarci qualcosa che si aprirà solo in futuro', group: 'ricordi', primary: true, homeArea: 'giardino' },

  { id: 'mappa', emoji: '🗺️', route: '/mappa', fallbackName: 'La Mappa', fallbackDescription: 'I luoghi che sogniamo di visitare insieme e che magari un giorno visiteremo davvero', group: 'insieme', primary: true, homeArea: 'prato' },
  { id: 'cose-da-fare-insieme', emoji: '📔', route: '/cose-da-fare-insieme', fallbackName: "L'Agenda delle Idee", fallbackDescription: 'La famosa lista delle cose da fare, ora è anche tua', group: 'insieme', primary: true, homeArea: 'prato' },
  { id: 'ricettario', emoji: '🍳', route: '/ricettario', fallbackName: 'Il Ricettario', fallbackDescription: 'Tutte le nostre ricette raccolte, come se fosse un libro di cucina', group: 'insieme', primary: true, homeArea: 'prato' },
  { id: 'aula-studio', emoji: '🏫', route: '/aula-studio', fallbackName: 'L’Aula studio', fallbackDescription: 'Argomenti e flash card per ripassare senza distrazioni', group: 'insieme', primary: true, homeArea: 'prato' },

  { id: 'tavolo-da-gioco', emoji: '🎲', route: '/tavolo-da-gioco', fallbackName: 'Il Tavolo da Gioco', fallbackDescription: 'L’hub dei giochi', group: 'giochi', primary: true, homeArea: 'prato' },
  { id: 'trappole', emoji: '💣', route: '/tavolo-da-gioco/trappole', fallbackName: 'Ti preparo una trappola', fallbackDescription: 'Una sfida a due tra trappole, indizi e percorsi da scoprire.', tagline: 'Sfida a due', group: 'giochi', parentId: 'tavolo-da-gioco' },
  { id: 'frequenze', emoji: '📡', route: '/tavolo-da-gioco/frequenze', fallbackName: 'Sulla stessa frequenza', fallbackDescription: 'Enigmi da risolvere insieme, ognuno con il proprio punto di vista.', tagline: 'Si gioca insieme', group: 'giochi', parentId: 'tavolo-da-gioco' },
  { id: 'animali', emoji: '🐾', route: '/tavolo-da-gioco/animali', fallbackName: 'La casa degli animali', fallbackDescription: 'Un uovo da schiudere e piccoli animali da accudire insieme.', tagline: 'Chi c’è nell’uovo?', group: 'giochi', parentId: 'tavolo-da-gioco' },
  { id: 'cruciverba', emoji: '🧩', route: '/tavolo-da-gioco/cruciverba', fallbackName: 'Il Cruciverba', fallbackDescription: 'Un cruciverba con tanti dei nostri ricordi', group: 'giochi', parentId: 'tavolo-da-gioco' },
  { id: 'messaggio-criptato', emoji: '🗝️', route: '/tavolo-da-gioco/messaggio-criptato', fallbackName: 'Il Messaggio Criptato', fallbackDescription: 'Una sfida a tradurre un messaggio criptato, puoi farcela', group: 'giochi', parentId: 'tavolo-da-gioco' },
  { id: 'gdr', emoji: '🐉', route: '/tavolo-da-gioco/gdr', fallbackName: 'I Giochi di Ruolo', fallbackDescription: 'Lo sai, la mia passione più grande e vorrei condividerla con te, chissà magari alla fine faremo qualcosa di più grande insieme ahaha', group: 'giochi', parentId: 'tavolo-da-gioco' },
  { id: 'prova-a-dire-no', emoji: '👀', route: '/tavolo-da-gioco/prova-a-dire-no', fallbackName: 'Prova a Dire No', fallbackDescription: 'Le classiche cose a cui non si riesce a dire di no 👀', group: 'giochi', parentId: 'tavolo-da-gioco' },
  { id: 'carte', emoji: '🃏', route: '/tavolo-da-gioco/carte', fallbackName: 'Le Carte Collezionabili', fallbackDescription: 'Un’idea che mi è venuta per avere la nostra collezione personale', group: 'giochi', parentId: 'tavolo-da-gioco' },
  { id: 'linguaggio-segreto', emoji: '🔣', route: '/linguaggio-segreto', fallbackName: 'Il Linguaggio Segreto', fallbackDescription: 'Il nostro linguaggio segreto, se ogni tanto abbiamo bisogno di dirci qualcosa che possiamo capire solo noi', group: 'ricordi', parentId: 'ponti' },

  { id: 'impostazioni-mondo', emoji: '🎛️', route: '/impostazioni-mondo', fallbackName: 'Il Centro di Controllo', fallbackDescription: 'Un posto per personalizzare il nostro mondo', group: 'mondo', primary: true, homeArea: 'osservatorio' },
  { id: 'il-cielo', emoji: '🌌', route: '/il-cielo', fallbackName: 'Il Cielo', fallbackDescription: 'Uno spazio vuoto e calmo per goderti il cielo del mondo bianco', group: 'mondo', primary: true, homeArea: 'osservatorio' },
  { id: 'novita', emoji: '✨', route: '/novita', fallbackName: 'Le Novità', fallbackDescription: 'Quello che è comparso nel Mondo Bianco mentre non guardavi', group: 'mondo', primary: true, homeArea: 'osservatorio' },
  { id: 'suggerimenti', emoji: '💭', route: '/suggerimenti', fallbackName: 'I Suggerimenti', fallbackDescription: 'Questo mondo è tanto mio quanto tuo, se vuoi creare qualcosa proponilo qui', group: 'mondo', homeArea: 'osservatorio' },
  { id: 'profilo', emoji: '👤', route: '/profilo', fallbackName: 'Il Profilo', fallbackDescription: 'Se vuoi cambiare password o il tuo nome', group: 'mondo' }
];
