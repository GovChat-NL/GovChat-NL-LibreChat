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

Restoring a starter snapshot does **not** activate ingest or incremental synchronization. Validate the manifest source and changes cursor, then configure and activate [`openbesluitvorming-sync.json`](../n8n/workflows/openbesluitvorming/openbesluitvorming-sync.json) only when its checkpoint compatibility has been reviewed.

## Refresh and withdrawal policy

- Refresh the dataset by creating a new immutable release artifact after the incremental changes feed has been applied and reviewed.
- Never mutate a previously published release asset in place; publish a new tag.
- If source material is withdrawn or a takedown is required, immediately stop distributing the affected release asset, document the withdrawal, and publish a replacement after the Qdrant deletion/sync has been verified.
- The Qdrant delta-sync understands OpenBesluitvorming tombstones. A static release artifact does not update by itself.
- Keep a release record with reviewer, publication date, source cursor, checksum, and withdrawal decision.

## Security and compatibility

Native Qdrant snapshots are implementation/version-sensitive. The manifest records the minimum supported Qdrant version and collection vector schema. Restore only into an empty compatible collection and verify the checksum first.

The snapshot payload includes source metadata and content previews. Public availability of source documents does not by itself settle redistribution, privacy, or retention questions. The publication review remains mandatory.
