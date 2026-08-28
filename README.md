# TONE3000 NAM2 Downloader

Node.js CLI for one-way local synchronization of public NAM A2 models from the configured TONE3000 creators.

## Requirements

- Node.js 20 or later
- A valid TONE3000 API key in `secret.json` (this file is not versioned)

## Configuration

Edit `config.json` to select creators and categories to synchronize. Only categories set to `true` are downloaded:

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

Creator usernames are normalized to lowercase automatically before querying the API.

For a new checkout, copy `secret.json.sample` to `secret.json` and enter your key. Alternatively, use the `TONE3000_API_KEY` environment variable, which takes precedence over the file.

## Commands

```sh
npm run sync                 # all configured creators
npm run sync -- --user 2dor  # one creator only
npm run sync -- --dry-run    # show actions without writing files
npm run status               # local manifest summary
npm test
```

## File layout

```text
data/users/<creator>/<category>/<tone title> [tone-<id>]/<model name> [model-<id>].nam
```

Characters that are incompatible with file names are normalized. IDs keep profiles and models with the same name unique.

## Synchronization policy

The `data/.tone3000-sync.json` manifest stores the remote version and SHA-256 hash for every written file. It is updated atomically after every completed download or update, so an interrupted run preserves completed progress. Synchronization downloads new or remotely updated models, never deletes local files, and never overwrites a locally modified file; such cases are reported as conflicts. Downloads are written to a temporary file and then atomically renamed.

Every `sync` command also creates a text summary in `data/logs/YYYY-mm-DD-HH-MM tone3000downloader.log`. The file records startup, authentication, every model action, errors, and the final summary. If two sessions start within the same minute, the second file receives a numeric suffix to avoid overwriting the previous log.

The CLI uses authenticated TONE3000 endpoints to find each creator's NAM A2 tones, retrieve their A2 model lists, and download models individually. Requests are serialized at roughly 90 per minute to stay within the default API limit.
