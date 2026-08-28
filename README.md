# TONE3000 NAM2 Downloader

CLI Node.js per sincronizzare in locale, in sola direzione, i modelli NAM A2 pubblici degli autori configurati su TONE3000.

## Requisiti

- Node.js 20 o superiore
- una API key TONE3000 valida in `secret.json` (il file non viene versionato)

## Configurazione

Modifica `config.json` per scegliere gli autori e le categorie da sincronizzare. Sono scaricati solo i tipi con valore `true`:

```json
{
  "users": ["jesco"],
  "categories": {
    "amp": true,
    "amp-cab": true,
    "pedal": false,
    "outboard": false,
    "cab": true,
    "space": false,
    "experimental": false
  }
}
```

Per impostare una chiave su un nuovo checkout, copia `secret.json.sample` in `secret.json` e inserisci la chiave. In alternativa è supportata la variabile d'ambiente `TONE3000_API_KEY`, che ha precedenza sul file.

## Comandi

```sh
npm run sync                 # tutti gli utenti configurati
npm run sync -- --user 2dor  # un solo utente
npm run sync -- --dry-run    # mostra le azioni senza scrivere
npm run status               # riepilogo del manifest locale
npm test
```

## Organizzazione dei file

```text
data/users/<autore>/<tipologia>/<titolo tone> [tone-<id>]/<nome modello> [model-<id>].nam
```

I caratteri non compatibili con i nomi file vengono normalizzati; gli ID mantengono univoci profili e modelli con lo stesso nome.

## Politica di sincronizzazione

Il manifest `data/.tone3000-sync.json` registra la versione remota e l'hash SHA-256 di ciascun file scritto. Viene aggiornato atomicamente dopo ogni download o aggiornamento completato, per cui un'interruzione conserva i progressi già eseguiti. La sincronizzazione scarica modelli nuovi o aggiornati sul sito, non cancella mai file locali e non sovrascrive un file modificato localmente: in quest'ultimo caso segnala un conflitto. I download vengono scritti prima in un file temporaneo e poi rinominati atomicamente.

Ogni comando `sync` crea anche un riepilogo testuale in `data/logs/YYYY-mm-DD-HH-MM tone3000downloader.log`. Il file annota avvio, autenticazione, ciascuna azione sul modello, errori e riepilogo finale. Se due sessioni iniziano nello stesso minuto, la seconda aggiunge un suffisso numerico per non sovrascrivere il log precedente.

La CLI usa gli endpoint autenticati TONE3000 per cercare tone NAM A2 di ogni autore, ottenere l'elenco di modelli A2 e scaricarli singolarmente. Le richieste vengono serializzate a circa 90/minuto per restare sotto il limite API predefinito.
