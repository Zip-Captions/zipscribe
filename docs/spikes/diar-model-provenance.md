# Unit-06 slice B — diarization model provenance (FR-03.1 doctrine)

Date: 2026-11-10 (verified on this date, pinned thereafter). Hosts: `huggingface.co`
(allowlisted, `settings.yml operations.model_hosts`); one sanctioned one-time
artifact download from the k2-fsa GitHub release for cross-hashing only (unit-06
brief, Risks + discovery.md provenance warning — never a runtime/test host).

Doctrine: every row pins **repo + 40-hex revision + per-file SHA-256**; unpinned
repos are forbidden. The ERes2Net candidate is self-tagged `mirror` on HF, so the
unit spec (Risks, "Docs to consult") gates it: it must be tied to the upstream
3D-Speaker release artifact or exported ourselves.

## Rows pinned this slice

| cache dir (frozen e2e name) | repo @ revision | files → SHA-256 (bytes) | license |
|---|---|---|---|
| `pyannote-segmentation-3-0` | `onnx-community/pyannote-segmentation-3.0` @ `733a93b6473d019a773298e08cefa686894b1854` | `config.json` → `5a4c6bb4f49f1b47c9bd398aac78b8cd4a9f30a0ff91b5c2dc68d05e13e160cf` (408) · `preprocessor_config.json` → `dfc7d35a3895f8997eb94521e28b1921c03480a34fa9bcbb6bef1f1934f81480` (158) · `onnx/model.onnx` (fp32) → `057ee564753071c0b09b5b611648b50ac188d50846bff5f01e9f7bbf1591ea25` (5 986 908) | MIT |
| `eres2net-base-3dspeaker` | `onemira/eres2net-base-3dspeaker-onnx` @ `e63c37526aa23092d9de764d323d769337f2b2a8` | `3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx` → `1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b` (39 593 761) | Apache-2.0 |

Both files were downloaded once from the pinned revision (`resolve/<40-hex>/…`,
never `main`) and hashed with SHA-256; the values above are the measured digests,
recorded verbatim in `models/ci-registry.json` + `models/eval-registry.json` and
mirrored in `src/engine/model/registry.ts` (`DIAR_MODEL_REGISTRY`).
`pnpm models:fetch` re-hashes every cache hit against these pins (it refuses to
install any byte drift) and installed both dirs into `.cache/models/`.

## pyannote-segmentation-3.0 — license re-verification

`GET https://huggingface.co/api/models/onnx-community/pyannote-segmentation-3.0/revision/733a93b6…`
→ `cardData.license = "mit"`, tag `license:mit`. Orchestrator-verified same day;
re-verified here. The repo is onnx-community's official ONNX export of
`pyannote/segmentation-3.0` (pyannote community, MIT). `config.json` is the
pyannote multi-class frame-classification head (`NO_SPEAKER`, `SPEAKER_n`,
pairwise `SPEAKERS_i_AND_j` labels) consumed by
`AutoModelForAudioFrameClassification` (FR-06.1). fp32 `onnx/model.onnx` is the
wasm-tier artifact (the model is WebGPU-unsupported, microsoft/onnxruntime#21386).
**Verdict: accepted.**

## ERes2Net — mirror tie-out (the gated provenance task)

Candidate repo `onemira/eres2net-base-3dspeaker-onnx` self-tags `mirror`.
The unit brief required tying it to the k2-fsa release artifact (the sherpa-onnx
WASM fallback remains an orchestrator decision, not taken here).

### Chain recorded by the mirror (in-repo `source-metadata.json`, `NOTICE`)

- `source_url`: `https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx` (tag name carries the upstream typo "recongition")
- declared `size` 39 593 761, declared `sha256` `1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b`, `byte_changes: "none"`, `weight_license: "apache-2.0"`
- `NOTICE`: upstream = ModelScope `iic/speech_eres2net_base_sv_zh-cn_3dspeaker_16k` (3D-Speaker team); ONNX conversion/distribution = k2-fsa/sherpa-onnx; export script copyright 2023-2024 Xiaomi Corp. (Fangjun Kuang), `conversion_source` = `k2-fsa/sherpa-onnx` @ `cb2beea…` `scripts/3dspeaker/export-onnx.py`
- `license_sources`: `LICENSE` from `modelscope/3D-Speaker` @ `065629c…`, `LICENSE.sherpa-onnx` from `k2-fsa/sherpa-onnx` @ `cb2beea…`

### Independent verification performed today (hashes, not trust-me)

1. **Mirror file** — `curl` from the pinned HF revision, hashed:
   `1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b` — matches the mirror's own declaration **and** the value this slice pins.
2. **k2-fsa GitHub release artifact** — downloaded once (sanctioned for hashing)
   from the `source_url` above, hashed:
   `1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b` — **byte-identical to the mirror file** (same size, same digest). The mirror is the release artifact, unchanged.
3. **License texts** — in-repo `LICENSE` and `LICENSE.sherpa-onnx` hashed:
   `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4` and `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30` (both the standard Apache-2.0 text; identical to the digests `source-metadata.json` declares for the upstream files at the pinned commits). In-repo `NOTICE` hash `7b43627922183a2f04a7d9550ae4fec154b5ca031cccc02502c16dbab2ae6f37` also matches its declaration.
4. **Third-party corroboration** — docs-mcp `sherpa-onnx` page *Speaker Diarization*
   (k2-fsa.github.io, javascript-api examples) documents exactly this file as the
   embedding model of the reference pyannote+ERes2Net diarization pipeline:
   `https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx`

### Not independently verified (stated honestly)

- `model_card_url` (ModelScope `iic/speech_eres2net_base_sv_zh-cn_3dspeaker_16k`
  README, modelscope.cn) — outside the repo network allowlist; its SHA-256 is
  recorded by the mirror metadata but was not re-hashed here. The upstream
  attribution itself is corroborated by the NOTICE + 3D-Speaker LICENSE tie-out
  above (an Apache-2.0 project).

### Verdict

`onemira/eres2net-base-3dspeaker-onnx@e63c3752…` **ties byte-identically to the
k2-fsa/sherpa-onnx GitHub release artifact** (the one the sherpa-onnx
speaker-diarization docs prescribe) and through it to the Apache-2.0 3D-Speaker
ERes2Net-base weights. Accepted under FR-03.1 — no silent substitution, and the
sherpa-onnx-WASM fallback was not needed.

## Reproduction (auditors)

```bash
# pinned HF mirror file
curl -sSL https://huggingface.co/onemira/eres2net-base-3dspeaker-onnx/resolve/e63c37526aa23092d9de764d323d769337f2b2a8/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx | shasum -a 256
# k2-fsa release artifact (one-time, provenance audit only)
curl -sSL https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx | shasum -a 256
# both must print 1a331345f04805badbb495c775a6ddffcdd1a732567d5ec8b3d5749e3c7a5e4b
# setup install (hf.co only, SHA-256 verified): corepack pnpm models:fetch
```

SECURITY-03: this document carries hashes, sizes and public URLs only — no
transcript, caption or audio-derived text.
