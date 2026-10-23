# OpenBesluitvorming starter-dataset release artifacts

## Purpose

GovChat-NL can distribute a ready-to-search OpenBesluitvorming starter dataset without asking every deployment to re-embed the same public source documents. The distribution mechanism is an **immutable Qdrant native snapshot attached to a GitHub Release**, paired with a small JSON manifest.

The snapshot binary is deliberately **not** committed to Git or Git LFS. It can be hundreds of megabytes, grows over time, and must be withdrawable independently of source code history.

The initial starter dataset target is:

- provider: [OpenBesluitvorming](https://openbesluitvorming.nl/)
- source key: `provincie_limburg`
- vector database: Qdrant
- vector schema: 3,072 dimensions, Cosine distance
- embedding alias: `govchat-embedding`

## Artifact contract

Every release contains exactly these deliverables:

1. A native Qdrant collection snapshot (`.snapshot`), created from a completed collection.
2. A generated manifest (`.manifest.json`) containing the Qdrant version/schema, source key, OpenBesluitvorming changes cursor, point counts, checksum, and governance flags.

Use [`releases/openbesluitvorming-provincie-limburg.manifest.example.json`](../releases/openbesluitvorming-provincie-limburg.manifest.example.json) as the contract reference. The release must contain the generated manifest, not the example file. The manifest field `source_changes_cursor` is mandatory: it connects the immutable starter snapshot to the subsequent OpenBesluitvorming delta-sync position.

## Local Compose test restore

The pinned release assets are downloaded to the Git-ignored `testdata/openbesluitvorming/` directory with the GitHub CLI. The opt-in Compose profile verifies the manifest size and SHA-256, copies the snapshot into a named Docker volume, and restores it into the internal Qdrant service. The 264,777,216-byte snapshot remains outside Git and is cached in Docker storage after the first restore. This profile is not run by a normal `docker compose up`.

In PowerShell, download the pinned release assets, then explicitly acknowledge the test restore and run the one-shot Compose service:

```powershell
New-Item -ItemType Directory -Force testdata/openbesluitvorming | Out-Null
gh release download v2026.10.08 --repo GovChat-NL/GovChat-NL-LibreChat --pattern 'openbesluitvorming-provincie_limburg-v2026.10.08.manifest.json' --dir testdata/openbesluitvorming
gh release download v2026.10.08 --repo GovChat-NL/GovChat-NL-LibreChat --pattern '*.snapshot' --dir testdata/openbesluitvorming
$manifest = Get-Content -Raw testdata/openbesluitvorming/openbesluitvorming-provincie_limburg-v2026.10.08.manifest.json | ConvertFrom-Json
Get-FileHash -Algorithm SHA256 (Join-Path testdata/openbesluitvorming $manifest.artifact.file_name)
$env:OPENBESLUITVORMING_TEST_RESTORE_APPROVED = 'yes'
docker compose --env-file .env.example --profile openbesluitvorming-test run --rm openbesluitvorming-test-restore
Remove-Item Env:OPENBESLUITVORMING_TEST_RESTORE_APPROVED
```

Compose starts Qdrant if needed and leaves it running after the restore container exits. Then start the rest of the application normally with `docker compose up -d`. The imported collection is `openraadsinformatie_v1` and the search workflow defaults to that collection.

The restore refuses to replace an existing collection. If you intentionally need to reset the local test collection, set both `OPENBESLUITVORMING_TEST_RESTORE_APPROVED=yes` and `OPENBESLUITVORMING_TEST_RESTORE_REPLACE_EXISTING=yes` for that run. This deletes the existing `openraadsinformatie_v1` collection before restoring the release snapshot.

## Publishing a release artifact

Publishing is an explicit operator task, never a Compose-start action.

Preconditions:

- The initial snapshot checkpoint has `completed: true`.
- The collection is green and has the expected vector schema.
- The OpenBesluitvorming source, provenance, redistribution terms, privacy implications, and takedown process have been reviewed.
- An owner is assigned for refreshes and withdrawals.
- The initial ingest runner is inactive after completion; use the incremental sync workflow for future mutations.

Create local release candidates:

```sh
OPENBESLUITVORMING_RELEASE_GOVERNANCE_APPROVED=yes \
  scripts/openbesluitvorming-release-snapshot.sh \
    --tag v2026.10.08 \
    --source-key provincie_limburg \
    --collection openraadsinformatie_v1 \
    --checkpoint-id 11111111-1111-5111-8111-111111111111 \
    --output-dir ./release-artifacts
```

The command only creates a Qdrant snapshot, manifest, and SHA-256 checksum locally. It does not upload or publish anything.

Review both files and attach them to an immutable GitHub Release. Do not commit the binary snapshot into the repository. The generated manifest must state the exact artifact filename and SHA-256.

## Opt-in restore

Restoration is also explicit. It verifies the manifest checksum before asking Qdrant to recover the native snapshot:

```sh
OPENBESLUITVORMING_RESTORE_APPROVED=yes \
  scripts/openbesluitvorming-restore-release-snapshot.sh \
    --manifest-url https://github.com/GovChat-NL/GovChat-NL-LibreChat/releases/download/v2026.10.08/openbesluitvorming-provincie-limburg.manifest.json \
    --snapshot-url https://github.com/GovChat-NL/GovChat-NL-LibreChat/releases/download/v2026.10.08/openbesluitvorming-provincie-limburg.snapshot \
    --collection openraadsinformatie_v1
```

The restore script refuses to overwrite an existing collection by default. Replacing it requires the additional explicit environment acknowledgement `OPENBESLUITVORMING_RESTORE_REPLACE_EXISTING=yes`.

Restoring a starter snapshot does **not** activate ingest or incremental synchronization. Validate the manifest source and changes cursor, then configure and activate [`openbesluitvorming-sync.json`](../agents/n8n/workflows/openbesluitvorming-sync.json) only when its checkpoint compatibility has been reviewed.

## Refresh and withdrawal policy

- Refresh the dataset by creating a new immutable release artifact after the incremental changes feed has been applied and reviewed.
- Never mutate a previously published release asset in place; publish a new tag.
- If source material is withdrawn or a takedown is required, immediately stop distributing the affected release asset, document the withdrawal, and publish a replacement after the Qdrant deletion/sync has been verified.
- The Qdrant delta-sync understands OpenBesluitvorming tombstones. A static release artifact does not update by itself.
- Keep a release record with reviewer, publication date, source cursor, checksum, and withdrawal decision.

## Security and compatibility

Native Qdrant snapshots are implementation/version-sensitive. The manifest records the minimum supported Qdrant version and collection vector schema. Restore only into an empty compatible collection and verify the checksum first.

The snapshot payload includes source metadata and content previews. Public availability of source documents does not by itself settle redistribution, privacy, or retention questions. The publication review remains mandatory.

## Weekly automated publication

The weekly publisher is [`scripts/openbesluitvorming-weekly-release.sh`](../scripts/openbesluitvorming-weekly-release.sh). The supplied cron template [`cron/openbesluitvorming-weekly-release.cron`](../cron/openbesluitvorming-weekly-release.cron) runs at **Sunday 20:00 UTC**, two hours after the Sunday 18:00 UTC delta-sync window.

Before any snapshot or release is created, the publisher requires both explicit governance acknowledgements and verifies all of the following from the private local Qdrant checkpoint:

- the initial snapshot is complete;
- the source key and initial changes cursor exist;
- a delta-sync cursor has been committed;
- the last delta page is caught up (`sync_has_more: false`);
- no immutable release already exists for the ISO week;
- no other weekly publisher holds the local lock.

If any check fails, it exits without creating a snapshot or GitHub Release. A failed weekly publication is therefore retried on the following week only after the underlying sync or governance issue has been resolved. Existing releases are never overwritten. Keep previous release assets available until any refresh, withdrawal, or takedown decision has been reviewed and documented.

The cron environment file is deliberately outside Git at `/etc/govchat/openbesluitvorming-release.env`. It contains only local operator acknowledgements and optional artifact-directory settings; it must not contain a public Qdrant URL or Qdrant credentials. Qdrant remains Docker-internal/localhost-only throughout snapshot creation and publication.
