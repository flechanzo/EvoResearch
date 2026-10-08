# Offline SOURCE_SELECT ranking comparison

Reference run: run-2026-10-03T12-42-31-800Z-c2dadfeb. Read-only replay; no retrieval or scientific evidence generation.

Ranking annotations are audit judgments, not scientific evidence or relevance ground truth.

## Aggregate comparison

```json
{
  "queries": 12,
  "queryLocalCandidatePaths": 208,
  "canonicalRecords": 192,
  "selectedRows": 56,
  "retainedRows": 45,
  "topKOverlap": "45/56",
  "changedQueries": 6,
  "replacedSelectedRows": 11,
  "changedSelectedRows": 22,
  "zeroCandidateQueries": 0,
  "oldZeroSelectionQueries": 0,
  "newZeroSelectionQueries": 0,
  "zeroLexicalOverlapQueries": [],
  "oldTies": {
    "groups": 43,
    "candidates": 180,
    "pairs": 455
  },
  "newTies": {
    "groups": 39,
    "candidates": 180,
    "pairs": 446
  },
  "oldConcentration": {
    "uniqueSelectedRecords": 52,
    "repeatedRecords": 3,
    "maximumQueryPathsPerRecord": 3,
    "repeated": [
      {
        "literatureId": "literature_63112ca408158ebe2f774c10",
        "queryPaths": 2
      },
      {
        "literatureId": "literature_9b9abf100115320323f4b34b",
        "queryPaths": 3
      },
      {
        "literatureId": "literature_5d8da82f4610180916605018",
        "queryPaths": 2
      }
    ]
  },
  "newConcentration": {
    "uniqueSelectedRecords": 53,
    "repeatedRecords": 3,
    "maximumQueryPathsPerRecord": 2,
    "repeated": [
      {
        "literatureId": "literature_63112ca408158ebe2f774c10",
        "queryPaths": 2
      },
      {
        "literatureId": "literature_9b9abf100115320323f4b34b",
        "queryPaths": 2
      },
      {
        "literatureId": "literature_5d8da82f4610180916605018",
        "queryPaths": 2
      }
    ]
  },
  "benchmark": {
    "clearlyBadLexicalCollisionsRemoved": [],
    "clearlyBadLexicalCollisionsRetained": [
      "irrelevant-verification-collision",
      "generic-security-collision"
    ],
    "apparentlyRelevantCandidatesLost": [],
    "ambiguousChangesRequiringLaterEvaluation": [
      "weak-ambiguous-quantum-watermark",
      "low-information-operator-query"
    ]
  }
}
```

Score ties count equal **total scores** across all local candidates. Groups count repeated scores; pairs count unordered tied candidate pairs. Changed rows count both removed and added selections.

## Per-query comparison

| Query | Candidates | Retained/top-k | Replacements | Tied pairs old → new |
|---|---:|---:|---:|---:|
| query_47e09645a99cdef174e7a534 | 20 | 5/5 | 0 | 91 → 73 |
| query_ac608f3c13527e6502e51e94 | 1 | 1/1 | 0 | 0 → 0 |
| query_bd10b0208eb529716404ec5f | 20 | 5/5 | 0 | 32 → 42 |
| query_0a51ed1f2a14a312d1e80089 | 20 | 4/5 | 1 | 32 → 39 |
| query_e22b9ba77b4b6b1b11d730e4 | 20 | 4/5 | 1 | 32 → 37 |
| query_6a2e0c53781bf79a9ccfbac8 | 7 | 5/5 | 0 | 2 → 4 |
| query_563246bb75d31d968bfbbd00 | 20 | 5/5 | 0 | 53 → 46 |
| query_c7ae46d8c78e07db4e93ab3e | 20 | 5/5 | 0 | 73 → 65 |
| query_78f5b879f1a8b0edb52044c9 | 20 | 2/5 | 3 | 39 → 35 |
| query_5e324ed6c323029c328d14fe | 20 | 3/5 | 2 | 18 → 19 |
| query_a1ddd297cdac0eb9debffc79 | 20 | 3/5 | 2 | 23 → 36 |
| query_a0dbca3b483ee2dd26900d7c | 20 | 3/5 | 2 | 60 → 50 |

## query_47e09645a99cdef174e7a534

Retrieval need: retrieval_need_1ad103f91082ad72ed6cbd76

Query: independent gaussian effective noise

Normalized tokens: independent, gaussian, effective, noise

Removed stopwords: (none)

Old top-k: literature_337c91b28123121e1ea73c6f, literature_38dd56293170eb0c3dd6b21e, literature_628fe55bdfab09e25ae9a600, literature_62999a663755be4f0bfe2a72, literature_6594dad28346032f88db64a4

New top-k: literature_337c91b28123121e1ea73c6f, literature_38dd56293170eb0c3dd6b21e, literature_628fe55bdfab09e25ae9a600, literature_62999a663755be4f0bfe2a72, literature_6594dad28346032f88db64a4

| Candidate | ID | Old rank / score | New rank / score | Selection old → new | New matched tokens |
|---|---|---:|---:|---|---|
| Poisson-Gaussian Noise Reduction Using the Hidden Markov Model in Contourlet Domain for Fluorescence Microscopy Images | literature_337c91b28123121e1ea73c6f | 1 / 44 | 1 / 44 | true → true | independent, gaussian, effective, noise |
| Approximation of Achievable Rates in Additive Gaussian Mixture Noise Channels | literature_38dd56293170eb0c3dd6b21e | 2 / 44 | 2 / 44 | true → true | independent, gaussian, effective, noise |
| Hilbert transformer and time delay: statistical comparison in the presence of Gaussian noise | literature_628fe55bdfab09e25ae9a600 | 3 / 44 | 3 / 44 | true → true | independent, gaussian, effective, noise |
| Non-Gaussian Industrial Process Monitoring With Probabilistic Independent Component Analysis | literature_62999a663755be4f0bfe2a72 | 4 / 44 | 4 / 44 | true → true | independent, gaussian, effective, noise |
| A kind of effective method of removing compound noise in image | literature_6594dad28346032f88db64a4 | 5 / 44 | 5 / 44 | true → true | independent, gaussian, effective, noise |
| Maximum-likelihood array processing in non-Gaussian noise with Gaussian mixtures | literature_6759d2d1951885cd71afd284 | 6 / 44 | 6 / 44 | false → false | independent, gaussian, effective, noise |
| A programmable analog Gaussian noise generator for test applications / | literature_8aa93efb1765e723a5349c9b | 7 / 44 | 7 / 44 | false → false | independent, gaussian, effective, noise |
| On the near-equivalence of envelope and square-law detection of correlated Gaussian noise | literature_b7f093205f9db65644634c73 | 8 / 44 | 8 / 44 | false → false | independent, gaussian, effective, noise |
| Seismic Random Noise Attenuation Based on Non-IID Pixel-Wise Gaussian Noise Modeling | literature_d6ff2977e8bdefd1395bc2a0 | 9 / 44 | 9 / 34 | false → false | gaussian, effective, noise |
| Image Denoising in Mixed Poisson–Gaussian Noise | literature_1347763f6cf18dee296761b9 | 10 / 24 | 10 / 24 | false → false | gaussian, noise |
| Multiplicative Noise and Non-Gaussianity: A Paradigm for Atmospheric Regimes? | literature_1a0673565b292093670937c0 | 11 / 24 | 11 / 24 | false → false | gaussian, noise |
| Gaussian Blue Noise | literature_296eaba48ea0238197516bc9 | 12 / 24 | 12 / 24 | false → false | gaussian, noise |
| Estimating the Lasso's Effective Noise | literature_2dd102e57bcc8e616aa2f87c | 13 / 24 | 13 / 24 | false → false | effective, noise |
| Multiqubit spectroscopy of Gaussian quantum noise | literature_3ad93704f508c4dfb6a733f7 | 14 / 24 | 14 / 24 | false → false | gaussian, noise |
| Asymptotic equivalence of density estimation and Gaussian white noise | literature_645f83295cd629d95539cd57 | 15 / 24 | 15 / 24 | false → false | gaussian, noise |
| Qubit Noise Spectroscopy for Non-Gaussian Dephasing Environments | literature_6d8a709c9497d7d50a551245 | 16 / 24 | 16 / 24 | false → false | gaussian, noise |
| Independent component analysis in the presence of noise in fMRI | literature_76caea3edaef578de1e89a96 | 17 / 24 | 17 / 24 | false → false | independent, noise |
| Transitions induced by correlated Gaussian and non-Gaussian noises in a single-species model with Allee effect and aposematism | literature_a6b736fb399acd001a467f0d | 18 / 24 | 20 / 14 | false → false | gaussian |
| Reconstruction of a low-rank matrix in the presence of Gaussian noise | literature_b8e49b90a763094776a0c252 | 19 / 24 | 18 / 24 | false → false | gaussian, noise |
| Non-Gaussian noise spectroscopy with a superconducting qubit sensor | literature_cf01ce545ffc5f1c500d353b | 20 / 24 | 19 / 24 | false → false | gaussian, noise |

## query_ac608f3c13527e6502e51e94

Retrieval need: retrieval_need_3808edc0495d78f3b3a0b038

Query: the method relies ddim inversion restricting compatible continuous time ode based samplers and requires secure key management and operator involvement for verification

Normalized tokens: method, relies, ddim, inversion, restricting, compatible, continuous, time, ode, samplers, requires, secure, key, management, operator, involvement, verification

Removed stopwords: the, based, and, for

Old top-k: literature_642a99372d144209a96f8c37

New top-k: literature_642a99372d144209a96f8c37

| Candidate | ID | Old rank / score | New rank / score | Selection old → new | New matched tokens |
|---|---|---:|---:|---|---|
| Generative Diffusion Models for Wireless Networks: Fundamental, Architecture, and State-of-the-Art | literature_642a99372d144209a96f8c37 | 1 / 74 | 1 / 14 | true → true | key |

## query_bd10b0208eb529716404ec5f

Retrieval need: retrieval_need_3922316fdbfdef2ea1680d33

Query: exact inversion with awgn modeling and soft decision decoding

Normalized tokens: exact, inversion, awgn, modeling, soft, decision, decoding

Removed stopwords: with, and

Old top-k: literature_f08e0bc6b6d2f6aaf247ea86, literature_48987abbfb9924f4ee2ab1ae, literature_742e465bc69b3145892cb214, literature_90a23e85732a7c61e35c6b03, literature_0f6bcf79303289c581fdaa9d

New top-k: literature_f08e0bc6b6d2f6aaf247ea86, literature_0f6bcf79303289c581fdaa9d, literature_48987abbfb9924f4ee2ab1ae, literature_742e465bc69b3145892cb214, literature_90a23e85732a7c61e35c6b03

| Candidate | ID | Old rank / score | New rank / score | Selection old → new | New matched tokens |
|---|---|---:|---:|---|---|
| Low-Complexity Soft-Aided Error-and-Erasure Decoding for Generalized Product Codes | literature_f08e0bc6b6d2f6aaf247ea86 | 1 / 54 | 1 / 34 | true → true | soft, decision, decoding |
| Iterative Detection, Decoding and Channel Parameter Estimation for Orthogonally Modulated DS-CDMA Systems | literature_48987abbfb9924f4ee2ab1ae | 2 / 53 | 3 / 33 | true → true | soft, decision, decoding |
| Phase Noise in MIMO Systems: Bayesian Cramér–Rao Bounds and Soft-Input Estimation | literature_742e465bc69b3145892cb214 | 3 / 44 | 4 / 24 | true → true | exact, soft |
| Efficient Low-Complexity Decoding of CCSDS Reed–Solomon Codes Based on Justesen’s Concatenation | literature_90a23e85732a7c61e35c6b03 | 4 / 44 | 5 / 24 | true → true | awgn, decoding |
| Soft detection and decoding in wideband CDMA systems | literature_0f6bcf79303289c581fdaa9d | 5 / 43 | 2 / 33 | true → true | soft, decision, decoding |
| Iterative decoding in analog VLSI | literature_1bae52565892b5e0b79785da | 6 / 34 | 7 / 14 | false → false | decoding |
| Diffusion-aided Task-oriented Semantic Communications with Model Inversion Attack | literature_8993dc97f559c59ae7f31eae | 7 / 34 | 8 / 14 | false → false | inversion |
| Decoding LDPC Codes with Probabilistic Local Maximum Likelihood Bit Flipping | literature_a2879f81cff7b4f2768e71e6 | 8 / 34 | 9 / 14 | false → false | decoding |
| Equalization and decoding - a continuous-time dynamical approach | literature_a61aafd570e9ce343345f375 | 9 / 34 | 10 / 14 | false → false | decoding |
| Code-Independent Error Floor Estimation Techniques for Flooding and Layered Decoders of LDPC Codes | literature_b61f9b1324c5ecb73d533d56 | 10 / 34 | 11 / 14 | false → false | awgn |
| Near-optimum decoding and performance bounds for multiple-antenna communication | literature_d89db9cf6637ad1eb04a6bab | 11 / 34 | 12 / 14 | false → false | decoding |
| Error Floor Approximation for LDPC Codes in the AWGN Channel | literature_ddcc65a829a2ac082681971b | 12 / 34 | 13 / 14 | false → false | awgn |
| Reducing the Complexity of Equalisation and Decoding of Shingled Writing | literature_e0538e8827053fcf9531f4b9 | 13 / 34 | 14 / 14 | false → false | decoding |
| Iterative equalization and decoding applied to underwater acoustic communication | literature_5ff9d94639a70940dffaa6e0 | 14 / 33 | 15 / 13 | false → false | decoding |
| MAP Joint Source-Channel Arithmetic Decoding for Compressed Video | literature_eccc83b13c9b028eb3b74fae | 15 / 33 | 17 / 13 | false → false | decoding |
| Information-optimal decoding and demodulation on sparse graphs | literature_16cd9e9e60aee3678c162974 | 16 / 24 | 6 / 14 | false → false | decoding |
| A Voltage Scaling Power Reduction Strategy for Memory-Based LDPC Decoders | literature_59d4bbfe077b4f02520bc327 | 17 / 23 | 20 / 3 | false → false | (none) |
| MIMO receivers using soft information | literature_641efaa537b20c13ce86fa42 | 18 / 23 | 16 / 13 | false → false | soft |
| Error Floor Analysis of LDPC Column Layered Decoders | literature_3a175a6b7fb810174c4bcd75 | 19 / 14 | 18 / 4 | false → false | (none) |
| Low-Complexity Decoder for Overloaded Uniquely Decodable Synchronous CDMA | literature_8cabe2b2ec15932e5df07979 | 20 / 14 | 19 / 4 | false → false | (none) |

## query_0a51ed1f2a14a312d1e80089

Retrieval need: retrieval_need_39a7a0028484aa4cb6ecfc09

Query: ecdsa public key signatures for third party verification

Normalized tokens: ecdsa, public, key, signatures, third, party, verification

Removed stopwords: for

Old top-k: literature_4bf292a1710491d883693fd2, literature_0dcdba635cea45166dba237a, literature_2d84aa4fe56e5e16fe723896, literature_db92f47354ce1656f775e905, literature_df2ebf75fb0332070eac9f62

New top-k: literature_4bf292a1710491d883693fd2, literature_0dcdba635cea45166dba237a, literature_db92f47354ce1656f775e905, literature_df2ebf75fb0332070eac9f62, literature_ea052884c73dfd03cb45a1ae

| Candidate | ID | Old rank / score | New rank / score | Selection old → new | New matched tokens |
|---|---|---:|---:|---|---|
| Threshold ECDSA with an Offline Recovery Party | literature_4bf292a1710491d883693fd2 | 1 / 74 | 1 / 64 | true → true | ecdsa, key, signatures, third, party, verification |
| Threshold ECDSA from ECDSA Assumptions: The Multiparty Case | literature_0dcdba635cea45166dba237a | 2 / 54 | 2 / 44 | true → true | ecdsa, key, signatures, party |
| Fast Multiparty Threshold ECDSA with Fast Trustless Setup | literature_2d84aa4fe56e5e16fe723896 | 3 / 54 | 7 / 34 | true → false | ecdsa, key, signatures |
| Key-Insulated and Privacy-Preserving Signature Scheme with Publicly Derived Public Key | literature_db92f47354ce1656f775e905 | 4 / 54 | 3 / 44 | true → true | public, key, signatures, verification |
| Weighted threshold ECDSA for securing bitcoin wallet | literature_df2ebf75fb0332070eac9f62 | 5 / 54 | 4 / 44 | true → true | ecdsa, public, key, verification |
| Application for digital signature and generation of certificates using the Bouncy Castle API considering digital signature law in El Salvador | literature_ea052884c73dfd03cb45a1ae | 6 / 54 | 5 / 44 | false → true | ecdsa, public, key, third |
| Uml Based Modeling of Ecdsa for Secured and Smart E-Governance System | literature_0f6536238655ae73ffa283d6 | 7 / 44 | 6 / 34 | false → false | ecdsa, key, signatures |
| Efficient and Secure ECDSA Algorithm and its Applications: A Survey | literature_59809a17d22ea0b09eff74d1 | 8 / 44 | 8 / 34 | false → false | ecdsa, public, key |
| Efficient and Secure ECDSA Algorithm and its Applications: A Survey | literature_7bd62c800f60bea5dd39271a | 9 / 44 | 9 / 34 | false → false | ecdsa, public, key |
| Elliptic Curve Digital Signature Algorithm for the Third Party Auditing | literature_9924ec377390dc28278919fa | 10 / 44 | 10 / 34 | false → false | third, party, verification |
| Scalable batch verification of ECDSA for blockchain using IVC | literature_ed7a7d0512e8d774e7e0e3a0 | 11 / 44 | 11 / 34 | false → false | ecdsa, signatures, verification |
| Blind ECDSA from the ECDSA Assumption | literature_3beeb529b2475d48f3918d4e | 12 / 34 | 14 / 24 | false → false | ecdsa, signatures |
| Preserving Data Privacy in the Internet of Medical Things Using Dual Signature ECDSA | literature_8aeafa71542dd96d895ea2a6 | 13 / 34 | 15 / 24 | false → false | ecdsa, signatures |
| Securing Medical Records of COVID-19 Patients Using Elliptic Curve Digital Signature Algorithm (ECDSA) in Blockchain | literature_b2c478e3bd3f948e37da829b | 14 / 34 | 16 / 24 | false → false | ecdsa, public |
| White-Box Implementation of ECDSA Based on the Cloud Plus Side Mode | literature_dd150d2ea5501069d7544497 | 15 / 34 | 17 / 24 | false → false | ecdsa, key |
| Fast Two-party Threshold ECDSA with Proactive Security | literature_09c2b0b50d210e3fd3039c67 | 16 / 24 | 12 / 24 | false → false | ecdsa, party |
| Threshold-Optimal DSA/ECDSA Signatures and an Application to Bitcoin Wallet Security | literature_2e009161dd22c3b226e512fc | 17 / 24 | 13 / 24 | false → false | ecdsa, signatures |
| Difference between ECDSA with ED25519 and Their Future | literature_3c2fffdc403aa7fb851959a1 | 18 / 24 | 18 / 14 | false → false | ecdsa |
| Prime Field ECDSA Signature Processing for Reconfigurable Embedded Systems | literature_c6fcd9a4f337f2316619c6c4 | 19 / 24 | 20 / 14 | false → false | ecdsa |
| Identity Based Public Verifiable Signcryption Scheme | literature_44af600b67960ccb449ea4bc | 20 / 14 | 19 / 14 | false → false | public |

## query_e22b9ba77b4b6b1b11d730e4

Retrieval need: retrieval_need_430836dfb6439f9e73739d91

Query: image manipulations undermine inversion based generative watermarking methods

Normalized tokens: image, manipulations, undermine, inversion, generative, watermarking, methods

Removed stopwords: based

Old top-k: literature_2e3dc4ecc2685d586d284722, literature_92712a198b96f16de7c4b542, literature_85480de905f7ab3a9f7b867f, literature_4371b04be6700e4d72bd0ecc, literature_529d8d72f64ec72a353b4941

New top-k: literature_92712a198b96f16de7c4b542, literature_2e3dc4ecc2685d586d284722, literature_4371b04be6700e4d72bd0ecc, literature_85480de905f7ab3a9f7b867f, literature_fc8dffe0f2dcd4bd46004d03

| Candidate | ID | Old rank / score | New rank / score | Selection old → new | New matched tokens |
|---|---|---:|---:|---|---|
| Vanishing Watermarks: Diffusion-Based Image Editing Undermines Robust Invisible Watermarking | literature_2e3dc4ecc2685d586d284722 | 1 / 74 | 2 / 54 | true → true | image, manipulations, generative, watermarking, methods |
| Latents-Inv:Robust Semantic Watermark via Dual-Path Mutual Information Redundancy for Diffusion Models | literature_92712a198b96f16de7c4b542 | 2 / 74 | 1 / 64 | true → true | image, manipulations, inversion, generative, watermarking, methods |
| Diffusion-Based Image Editing for Breaking Robust Watermarks | literature_85480de905f7ab3a9f7b867f | 3 / 64 | 4 / 54 | true → true | image, manipulations, generative, watermarking, methods |
| Image Watermarks are Removable Using Controllable Regeneration from Clean Noise | literature_4371b04be6700e4d72bd0ecc | 4 / 54 | 3 / 54 | true → true | image, manipulations, generative, watermarking, methods |
| From Attack to Protection: Leveraging Watermarking Attack Network for Advanced Add-on Watermarking | literature_529d8d72f64ec72a353b4941 | 5 / 54 | 18 / 14 | true → false | watermarking |
| CSGuard: Toward Forgery-Resistant Watermarking in Diffusion Models via Compressed Sensing Constraint | literature_6333a2fc97d0b23c8cd297c6 | 6 / 44 | 7 / 34 | false → false | image, watermarking, methods |
| PTW: Pivotal Tuning Watermarking for Pre-Trained Image Generators | literature_795e4434b7f38da14e3e9ef7 | 7 / 44 | 9 / 34 | false → false | image, watermarking, methods |
| Ownership Protection of Generative Adversarial Networks | literature_a2cb2788ae5b8c11d2917175 | 8 / 44 | 10 / 34 | false → false | image, generative, methods |
| Editing Away the Evidence: Diffusion-Based Image Manipulation and the Failure Modes of Robust Watermarking | literature_e18eb33c1b2aa36b7ef8a0b8 | 9 / 44 | 11 / 34 | false → false | image, generative, watermarking |
| XAttnMark: Learning Robust Audio Watermarking with Cross-Attention | literature_fb2f43c99b8f8138c41a7236 | 10 / 44 | 12 / 34 | false → false | generative, watermarking, methods |
| Modelship Attribution: Tracing Multi-Stage Manipulations Across Generative Models | literature_fc8dffe0f2dcd4bd46004d03 | 11 / 44 | 5 / 44 | false → true | image, manipulations, generative, methods |
| SoK: Watermarking for AI-Generated Content | literature_07dfd89ad2e5737ebd3fc756 | 12 / 34 | 6 / 34 | false → false | generative, watermarking, methods |
| Statistical Watermarking for Generative Images | literature_6014fc3a89e9f7270c74209f | 13 / 34 | 14 / 24 | false → false | generative, watermarking |
| Beyond Invisibility: Learning Robust Visible Watermarks for Stronger Copyright Protection | literature_685292c2916e5b44e66977b1 | 14 / 34 | 19 / 14 | false → false | methods |
| A comprehensive survey of watermarking techniques for copyright protection and integrity verification on DNNs and generative models | literature_7012adf10c9d613f36ec4d58 | 15 / 34 | 8 / 34 | false → false | generative, watermarking, methods |
| Secure AI Watermarking Framework for IP Protection in Multi-Tenant Cloud Platforms | literature_7d60dff3b3520da97a84a1ff | 16 / 34 | 15 / 24 | false → false | watermarking, methods |
| The Stable Signature: Rooting Watermarks in Latent Diffusion Models | literature_fdaefd3dd522bdb600f2a8d6 | 17 / 34 | 13 / 34 | false → false | image, generative, watermarking |
| A Survey on Proactive Deepfake Defense: Disruption and Watermarking | literature_9eb91674fa2a26958c49e635 | 18 / 24 | 16 / 24 | false → false | generative, watermarking |
| From Forensics to Ecosystems: Rethinking Watermarks for Generative AI Oversight | literature_35a0156632aba7d7e3b0c950 | 19 / 14 | 17 / 14 | false → false | generative |
| Watermarks are Not Verdicts: AI Provenance Marks, The EU AI Act, And Judicial Responsibility | literature_9ccf0e331fb9942bd02d842a | 20 / 4 | 20 / 4 | false → false | (none) |

## query_6a2e0c53781bf79a9ccfbac8

Retrieval need: retrieval_need_59c4b50de1782290c99e0c89

Query: watermark extraction uses ddim inversion reverses the watermark processing operations and votes over recovered bits

Normalized tokens: watermark, extraction, uses, ddim, inversion, reverses, processing, operations, votes, over, recovered, bits

Removed stopwords: the, and

Old top-k: literature_6276cb3f6546c58f094b23a1, literature_63112ca408158ebe2f774c10, literature_2cc77cbdb74a584a74b5093b, literature_9b9abf100115320323f4b34b, literature_789df5d48957b595ef8c85a3

New top-k: literature_6276cb3f6546c58f094b23a1, literature_63112ca408158ebe2f774c10, literature_2cc77cbdb74a584a74b5093b, literature_789df5d48957b595ef8c85a3, literature_9b9abf100115320323f4b34b

| Candidate | ID | Old rank / score | New rank / score | Selection old → new | New matched tokens |
|---|---|---:|---:|---|---|
| Robust watermarking for diffusion models using error-correcting codes and post-quantum key encapsulation | literature_6276cb3f6546c58f094b23a1 | 1 / 64 | 1 / 24 | true → true | watermark, extraction |
| GUISE: Graph GaUssIan Shading watErmark | literature_63112ca408158ebe2f774c10 | 2 / 64 | 2 / 24 | true → true | watermark, extraction |
| Gaussian Shannon: High-Precision Diffusion Model Watermarking Based on Communication | literature_2cc77cbdb74a584a74b5093b | 3 / 54 | 3 / 14 | true → true | watermark |
| A robust latent watermarking framework for diffusion-generated images with multi-objective optimization | literature_9b9abf100115320323f4b34b | 4 / 54 | 5 / 14 | true → true | extraction |
| Safety at Scale: A Comprehensive Survey of Large Model and Agent Safety | literature_789df5d48957b595ef8c85a3 | 5 / 44 | 4 / 14 | true → true | extraction |
| Q-Tag: Watermarking Quantum Circuit Generative Models | literature_a0ce809b1e5ca483d1fff12c | 6 / 43 | 6 / 13 | false → false | watermark |
| On the Trustworthiness Landscape of State-of-the-art Generative Models: A Survey and Outlook | literature_438daa8718a21f4b2aad64c7 | 7 / 24 | 7 / 4 | false → false | (none) |

## query_563246bb75d31d968bfbbd00

Retrieval need: retrieval_need_5c5b72556be0042b8048d33f

Query: performance losslessness guarantee depends computational security assumptions

Normalized tokens: performance, losslessness, guarantee, depends, computational, security, assumptions

Removed stopwords: (none)

Old top-k: literature_bba9df63b5e98c4b5bd3c68c, literature_d63d50d4536810712c36c9bc, literature_002c2e371ff6ab8640238a8f, literature_325c0a86e1552b5da5a4ae5d, literature_0cf286cbf12de930056dcb91

New top-k: literature_d63d50d4536810712c36c9bc, literature_002c2e371ff6ab8640238a8f, literature_325c0a86e1552b5da5a4ae5d, literature_bba9df63b5e98c4b5bd3c68c, literature_0cf286cbf12de930056dcb91

| Candidate | ID | Old rank / score | New rank / score | Selection old → new | New matched tokens |
|---|---|---:|---:|---|---|
| STIP: Three-Party Privacy-Preserving and Lossless Inference for Large Transformers in Production | literature_bba9df63b5e98c4b5bd3c68c | 1 / 34 | 4 / 24 | true → true | computational, assumptions |
| HIGH-PERFORMANCE COMPUTING ARCHITECTURES TO STRENGTHEN CLOUD INFRASTRUCTURE SECURITY | literature_d63d50d4536810712c36c9bc | 2 / 34 | 1 / 34 | true → true | performance, computational, security |
| On Multipath Routing in Multihop Wireless Networks: Security, Performance, and Their Tradeoff | literature_002c2e371ff6ab8640238a8f | 3 / 24 | 2 / 24 | true → true | performance, security |
| Multi-Scale Architectures Matter: On the Adversarial Robustness of Flow-based Lossless Compression | literature_325c0a86e1552b5da5a4ae5d | 4 / 24 | 3 / 24 | true → true | performance, computational |
| Security and performance considerations in wireless networks | literature_0cf286cbf12de930056dcb91 | 5 / 23 | 5 / 23 | true → true | performance, security |
| Parallel Secure Computation Scheme for Biometric Security and Privacy in Standard-Based BioAPI Framework | literature_0fec7bac3c40a8d469bfe49d | 6 / 14 | 6 / 14 | false → false | security |
| Lossless Privacy-Preserving Aggregation for Decentralized Federated Learning | literature_5f0abfecad47a8d1f59ebff6 | 7 / 14 | 14 / 4 | false → false | (none) |
| Traversal Learning: A Lossless And Efficient Distributed Learning Framework | literature_66ef052003cf6bd0c806ec6e | 8 / 14 | 7 / 14 | false → false | performance |
| A Comprehensive Review on Hyperspectral Image Lossless Compression Algorithms | literature_93c00a133fdd5b65c7c7d535 | 9 / 14 | 8 / 14 | false → false | performance |
| OmniFC: Rethinking Federated Clustering via Lossless and Secure Distance Reconstruction | literature_a8d4ec4dc114a7bf007f16f7 | 10 / 14 | 18 / 4 | false → false | (none) |
| Traversal Learning Coordination for Lossless and Efficient Distributed Learning | literature_ad9ff7e40eb6b107bd3fe807 | 11 / 14 | 9 / 14 | false → false | performance |
| WatME: Towards Lossless Watermarking Through Lexical Redundancy | literature_adafc2d3f29e35be8a90a57b | 12 / 14 | 10 / 14 | false → false | computational |
| Lossless Anti-Distillation Sampling | literature_bb91d944b05257f7ee82ff17 | 13 / 14 | 11 / 14 | false → false | performance |
| Performance-lossless Black-box Model Watermarking | literature_c8ce6987454c958d260edd3c | 14 / 14 | 12 / 14 | false → false | performance |
| Private Lossless Multiple Release | literature_e8964e6dc6a9a771ef019537 | 15 / 14 | 13 / 14 | false → false | guarantee |
| A Fast Method of Visually Lossless Compression of Dental Images | literature_6fbd51805abc73f8dee59cfa | 16 / 4 | 15 / 4 | false → false | (none) |
| Lossless fitness inheritance in genetic algorithms for decision trees | literature_8b18faa032526c97c6aab63d | 17 / 4 | 16 / 4 | false → false | (none) |
| WatME: Towards Lossless Watermarking Through Lexical Redundancy | literature_a441ef46b672acd53a941734 | 18 / 4 | 17 / 4 | false → false | (none) |
| Secure and privacy-preserving data sharing in the cloud based on lossless image coding | literature_f27627cb25c8b338be116812 | 19 / 4 | 19 / 4 | false → false | (none) |
| High-quality lossless web page template and data separation | literature_ec63d56ce64c347589416c29 | 20 / 3 | 20 / 3 | false → false | (none) |

## query_c7ae46d8c78e07db4e93ab3e

Retrieval need: retrieval_need_63b1caebd6e419693711075d

Query: computationally performance lossless watermarking

Normalized tokens: computationally, performance, lossless, watermarking

Removed stopwords: (none)

Old top-k: literature_01b0370ceeef83f8cfd632ba, literature_5d8da82f4610180916605018, literature_682331fade386f9c9b72d1c8, literature_a3162135d76a6bc3efaf9fe8, literature_c8ce6987454c958d260edd3c

New top-k: literature_01b0370ceeef83f8cfd632ba, literature_5d8da82f4610180916605018, literature_682331fade386f9c9b72d1c8, literature_a3162135d76a6bc3efaf9fe8, literature_c8ce6987454c958d260edd3c

| Candidate | ID | Old rank / score | New rank / score | Selection old → new | New matched tokens |
|---|---|---:|---:|---|---|
| Deep Robust Reversible Watermarking | literature_01b0370ceeef83f8cfd632ba | 1 / 34 | 1 / 34 | true → true | performance, lossless, watermarking |
| Gaussian Shading: Provable Performance-Lossless Image Watermarking for Diffusion Models | literature_5d8da82f4610180916605018 | 2 / 34 | 2 / 34 | true → true | performance, lossless, watermarking |
| Robust Zero-Watermarking of Color Medical Images Using Multi-Channel Gaussian-Hermite Moments and 1D Chebyshev Chaotic Map | literature_682331fade386f9c9b72d1c8 | 3 / 34 | 3 / 34 | true → true | performance, lossless, watermarking |
| Watermarking of ultrasound medical images in teleradiology using compressed watermark | literature_a3162135d76a6bc3efaf9fe8 | 4 / 34 | 4 / 34 | true → true | performance, lossless, watermarking |
| Performance-lossless Black-box Model Watermarking | literature_c8ce6987454c958d260edd3c | 5 / 34 | 5 / 34 | true → true | performance, lossless, watermarking |
| Optimal keyframe selection-based lossless video-watermarking technique using IGSA in LWT domain for copyright protection | literature_d4f61fa6407e3f8dd7c46a8a | 6 / 34 | 6 / 34 | false → false | performance, lossless, watermarking |
| Self-embedding watermarking for ciphertext images with lossless recovery capability | literature_e1d4691746e05073ede1d67b | 7 / 34 | 7 / 34 | false → false | performance, lossless, watermarking |
| Protection of Health Imagery by Region Based Lossless Reversible Watermarking Scheme | literature_f0fc061b0fb98190d7553873 | 8 / 34 | 8 / 34 | false → false | performance, lossless, watermarking |
| Deep Robust Reversible Watermarking | literature_2b93b9dcc6b96c120c05415c | 9 / 33 | 9 / 33 | false → false | performance, lossless, watermarking |
| Two-Stage Robust Lossless DWI Watermarking Based on Transformer Networks in the Wavelet Domain | literature_09bce8026a49dec951562f08 | 10 / 24 | 10 / 24 | false → false | lossless, watermarking |
| Lossless Audio Watermarking Based on the Alpha Statistic Modulation | literature_14f570731dd4b82773136187 | 11 / 24 | 11 / 24 | false → false | lossless, watermarking |
| A Blind Medical Image Watermarking for Secure E-Healthcare Application Using Crypto-Watermarking System | literature_18b5b2b0de0a1cb3e59e3139 | 12 / 24 | 12 / 24 | false → false | lossless, watermarking |
| A robust zero-watermarking algorithm for lossless copyright protection of medical images | literature_6859fd7eecebd352b9ed83ba | 13 / 24 | 13 / 24 | false → false | lossless, watermarking |
| Zero-Watermark Scheme for 2D Vector Drawings Based on Mapping | literature_85421d87529663ae9a2aace2 | 14 / 24 | 20 / 14 | false → false | lossless |
| WatME: Towards Lossless Watermarking Through Lexical Redundancy | literature_a441ef46b672acd53a941734 | 15 / 24 | 14 / 24 | false → false | lossless, watermarking |
| WatME: Towards Lossless Watermarking Through Lexical Redundancy | literature_adafc2d3f29e35be8a90a57b | 16 / 24 | 15 / 24 | false → false | lossless, watermarking |
| A lossless DWT-SVD domain watermarking for medical information security | literature_b1cecf7edd3d50c6a74c3e67 | 17 / 24 | 16 / 24 | false → false | lossless, watermarking |
| Lossless Watermarking Algorithm for Geographic Point Cloud Data Based on Vertical Stability | literature_cf97164bc589511142be26e2 | 18 / 24 | 17 / 24 | false → false | lossless, watermarking |
| A Region-Based Lossless Watermarking Scheme for Enhancing Security of Medical Data | literature_f413542399237dd6f29c09e3 | 19 / 24 | 18 / 24 | false → false | lossless, watermarking |
| An Overview of Digital Video Watermarking | literature_573e3864bfc6593303a35133 | 20 / 14 | 19 / 14 | false → false | watermarking |

## query_78f5b879f1a8b0edb52044c9

Retrieval need: retrieval_need_65eff9a88406d495711394a9

Query: dual mark joint sampling jointly embeds copyright and localization watermarks diffusion model latent space

Normalized tokens: dual, mark, joint, sampling, jointly, embeds, copyright, localization, watermarks, diffusion, model, latent, space

Removed stopwords: and

Old top-k: literature_7e7c6274fc0490b83803ba7c, literature_9b9abf100115320323f4b34b, literature_558cdc2d40d2f47a081dfc6e, literature_9e1ce05bfbf79052724d1209, literature_006b48acfde0ce24fe318360

New top-k: literature_9b9abf100115320323f4b34b, literature_7e7c6274fc0490b83803ba7c, literature_df280b9bbef6cf8a4ca95ea3, literature_e40b59e54cab88939c8d987a, literature_01ef8b42ea7f7c0bcd0cfe2b

| Candidate | ID | Old rank / score | New rank / score | Selection old → new | New matched tokens |
|---|---|---:|---:|---|---|
| GenPTW: Latent Image Watermarking for Provenance Tracing and Tamper Localization | literature_7e7c6274fc0490b83803ba7c | 1 / 94 | 2 / 54 | true → true | jointly, localization, diffusion, latent, space |
| A robust latent watermarking framework for diffusion-generated images with multi-objective optimization | literature_9b9abf100115320323f4b34b | 2 / 94 | 1 / 74 | true → true | embeds, copyright, watermarks, diffusion, model, latent, space |
| Dual-Guard: Dual-Channel Latent Watermarking for Provenance and Tamper Localization in Diffusion Images | literature_558cdc2d40d2f47a081dfc6e | 3 / 74 | 6 / 44 | true → false | dual, localization, diffusion, latent |
| RDSplat: Robust Watermarking for 3D Gaussian Splatting Against 2D and 3D Diffusion Editing | literature_9e1ce05bfbf79052724d1209 | 4 / 74 | 16 / 34 | true → false | jointly, watermarks, diffusion |
| DIP-Watermark: A Double Identity Protection Method Based on Robust Adversarial Watermark | literature_006b48acfde0ce24fe318360 | 5 / 64 | 10 / 34 | true → false | joint, embeds, space |
| EditGuard: Versatile Image Watermarking for Tamper Localization and Copyright Protection | literature_189fbfdcf4caa3db5cb989c4 | 6 / 64 | 13 / 34 | false → false | copyright, localization, watermarks |
| Beyond Invisibility: Learning Robust Visible Watermarks for Stronger Copyright Protection | literature_685292c2916e5b44e66977b1 | 7 / 64 | 7 / 44 | false → false | embeds, copyright, watermarks, model |
| DWR-Net: Diffusion-Based U-Net for Robust Watermark Removal - Empirical Evaluation on COCO and ImageNet | literature_6e93e2e85fef526de243bc8e | 8 / 64 | 8 / 44 | false → false | copyright, watermarks, diffusion, model |
| Dynamic watermarks in images generated by diffusion models | literature_78122d7ba30e37347db1a39c | 9 / 64 | 9 / 44 | false → false | copyright, watermarks, diffusion, model |
| InpDiffusion: Image Inpainting Localization via Conditional Diffusion Models | literature_df280b9bbef6cf8a4ca95ea3 | 10 / 64 | 3 / 54 | false → true | dual, sampling, localization, diffusion, model |
| InpDiffusion: Image Inpainting Localization via Conditional Diffusion Models | literature_e40b59e54cab88939c8d987a | 11 / 64 | 4 / 54 | false → true | dual, sampling, localization, diffusion, model |
| V2A-Mark: Versatile Deep Visual-Audio Watermarking for Manipulation Localization and Copyright Protection | literature_01ef8b42ea7f7c0bcd0cfe2b | 12 / 54 | 5 / 44 | false → true | mark, copyright, localization, watermarks |
| Audio Pirates: Black-box Audio Watermark Removal via Diffusion Priors | literature_0802ff7789503d8b71934942 | 13 / 54 | 11 / 34 | false → false | watermarks, diffusion, model |
| When Denoising Becomes Unsigning: Theoretical and Empirical Analysis of Watermark Fragility Under Diffusion-Based Image Editing | literature_13b1c89caf999b03b2652829 | 14 / 54 | 12 / 34 | false → false | diffusion, latent, space |
| Securing Large Language Models: A Survey of Watermarking and Fingerprinting Techniques | literature_3614dbb94a61de9f05128e7a | 15 / 54 | 14 / 34 | false → false | sampling, watermarks, model |
| A comprehensive survey of watermarking techniques for copyright protection and integrity verification on DNNs and generative models | literature_7012adf10c9d613f36ec4d58 | 16 / 54 | 15 / 34 | false → false | copyright, diffusion, model |
| A Survey on Proactive Deepfake Defense: Disruption and Watermarking | literature_9eb91674fa2a26958c49e635 | 17 / 54 | 18 / 14 | false → false | copyright |
| TriniMark: A Robust Generative Speech Watermarking Method for Trinity-Level Traceability | literature_fa1f3ca7d609ab3bcb69ce1a | 18 / 44 | 17 / 24 | false → false | diffusion, model |
| SoK: Watermarking for AI-Generated Content | literature_07dfd89ad2e5737ebd3fc756 | 19 / 34 | 19 / 4 | false → false | (none) |
| Watermarking Techniques for Large Language Models: A Survey | literature_1a02498a04186777a619d1d9 | 20 / 34 | 20 / 4 | false → false | (none) |

## query_5e324ed6c323029c328d14fe

Retrieval need: retrieval_need_733d2424b60613cd7f0b53fa

Query: gaussian shading embeds watermarks during initial latent sampling using watermark diffusion watermark randomization and distribution preserving sampling without changing model architecture parameters

Normalized tokens: gaussian, shading, embeds, watermarks, during, initial, latent, sampling, using, watermark, diffusion, randomization, distribution, preserving, without, changing, model, architecture, parameters

Removed stopwords: and

Old top-k: literature_0c3c7ab4e6bd85ecb8a5d611, literature_5d8da82f4610180916605018, literature_63112ca408158ebe2f774c10, literature_9b9abf100115320323f4b34b, literature_a0ce809b1e5ca483d1fff12c

New top-k: literature_0c3c7ab4e6bd85ecb8a5d611, literature_5d8da82f4610180916605018, literature_63112ca408158ebe2f774c10, literature_00748c4fee462f3a0ae208d1, literature_4d88102629ce1c78aceaaa0c

| Candidate | ID | Old rank / score | New rank / score | Selection old → new | New matched tokens |
|---|---|---:|---:|---|---|
| RAIN: Region-Aware Inversion Network for Semantic Watermark Extraction | literature_0c3c7ab4e6bd85ecb8a5d611 | 1 / 114 | 1 / 94 | true → true | gaussian, shading, watermarks, initial, latent, watermark, diffusion, preserving, model |
| Gaussian Shading: Provable Performance-Lossless Image Watermarking for Diffusion Models | literature_5d8da82f4610180916605018 | 2 / 114 | 2 / 84 | true → true | gaussian, shading, latent, sampling, watermark, diffusion, distribution, model |
| GUISE: Graph GaUssIan Shading watErmark | literature_63112ca408158ebe2f774c10 | 3 / 104 | 3 / 84 | true → true | gaussian, shading, latent, using, watermark, diffusion, preserving, model |
| A robust latent watermarking framework for diffusion-generated images with multi-objective optimization | literature_9b9abf100115320323f4b34b | 4 / 104 | 8 / 74 | true → false | embeds, watermarks, latent, using, diffusion, without, model |
| Q-Tag: Watermarking Quantum Circuit Generative Models | literature_a0ce809b1e5ca483d1fff12c | 5 / 103 | 9 / 73 | true → false | gaussian, embeds, latent, sampling, watermark, preserving, model |
| SuperMark: Robust and Training-free Image Watermarking via Diffusion-based Super-Resolution | literature_d7456dbfcd2fad82ba61c324 | 6 / 103 | 10 / 73 | false → false | gaussian, embeds, initial, using, watermark, diffusion, architecture |
| OSI: One-step Inversion Excels in Extracting Diffusion Watermarks | literature_00748c4fee462f3a0ae208d1 | 7 / 94 | 4 / 74 | false → true | gaussian, shading, watermarks, initial, watermark, diffusion, model |
| MSAT-LDM: Toward Transferable High-Fidelity Watermarking for Latent Diffusion Model via Modular Self-Augmented Training | literature_4d88102629ce1c78aceaaa0c | 8 / 94 | 5 / 74 | false → true | latent, watermark, diffusion, distribution, without, model, architecture |
| AnchorMark: Robust Diffusion Watermarking via Latent-Space Rotation Synchrony | literature_53dc1be9114fed2ffa7b019b | 9 / 94 | 6 / 74 | false → false | embeds, during, initial, latent, watermark, diffusion, preserving |
| Dual-Guard: Dual-Channel Latent Watermarking for Provenance and Tamper Localization in Diffusion Images | literature_558cdc2d40d2f47a081dfc6e | 10 / 94 | 11 / 64 | false → false | gaussian, shading, initial, latent, watermark, diffusion |
| CSGuard: Toward Forgery-Resistant Watermarking in Diffusion Models via Compressed Sensing Constraint | literature_6333a2fc97d0b23c8cd297c6 | 11 / 94 | 7 / 74 | false → false | embeds, watermarks, latent, watermark, diffusion, without, model |
| Robust spectral watermark for synthetic tabular data | literature_106681abf92ef37428bca720 | 12 / 84 | 13 / 54 | false → false | embeds, watermark, diffusion, preserving, without |
| GenPTW: Latent Image Watermarking for Provenance Tracing and Tamper Localization | literature_9a6ab6a830a5614e7ac9d089 | 13 / 84 | 16 / 54 | false → false | latent, using, watermark, diffusion, without |
| On the Information-Theoretic Limits of Latent-Space Watermarking Through Pretrained Generators | literature_ee9d0e9c2a3c9db2ca5f9fed | 14 / 84 | 12 / 64 | false → false | gaussian, latent, using, watermark, distribution, model |
| A Watermark for Vision-Language-Action and World Action Models | literature_20476f0b9d799cffe7b7fbe9 | 15 / 74 | 14 / 54 | false → false | gaussian, latent, watermark, distribution, model |
| SpreadMark: Robust Image Watermarking via Spread-Spectrum Embedding | literature_67f0943beea4ba5d296298d7 | 16 / 74 | 15 / 54 | false → false | watermarks, latent, watermark, model, architecture |
| Robust Watermarks Meet Backdoored Models: Evading Diffusion Semantic Watermarks via Stealthy Backdoor | literature_a8998d7c46c5123885736dbf | 17 / 73 | 18 / 43 | false → false | watermarks, latent, watermark, diffusion |
| Mitigating Watermark Forgery in Generative Models via Randomized Key Selection | literature_81a18112b02a62c95a6fd213 | 18 / 64 | 17 / 44 | false → false | watermarks, using, watermark, model |
| Watermarking Diffusion Language Models | literature_dbd18dfd8355dc6b04eaa8bb | 19 / 64 | 19 / 34 | false → false | watermarks, watermark, diffusion |
| Statistical Watermarking for Generative Images | literature_6014fc3a89e9f7270c74209f | 20 / 24 | 20 / 4 | false → false | (none) |

## query_a1ddd297cdac0eb9debffc79

Retrieval need: retrieval_need_7d11bbbb88a9a9568fba62ce

Query: forgery attacks can cause content generated from recovered latent representation attributed the original user

Normalized tokens: forgery, attacks, cause, content, generated, recovered, latent, representation, attributed, original, user

Removed stopwords: can, from, the

Old top-k: literature_07dfd89ad2e5737ebd3fc756, literature_1f52953dd29c9d386f9706d4, literature_cc7aa023fb0f7c0d588eaa3a, literature_e20d0e327ed39be5f8ae1fac, literature_039a5b225047a6ab57713ac0

New top-k: literature_f9a05dbe5f39a229264fb448, literature_07dfd89ad2e5737ebd3fc756, literature_1f52953dd29c9d386f9706d4, literature_cc7aa023fb0f7c0d588eaa3a, literature_d5bdf31c9d14e88e389c2fe4

| Candidate | ID | Old rank / score | New rank / score | Selection old → new | New matched tokens |
|---|---|---:|---:|---|---|
| SoK: Watermarking for AI-Generated Content | literature_07dfd89ad2e5737ebd3fc756 | 1 / 64 | 2 / 34 | true → true | attacks, content, generated |
| DP-TLDM: Differentially Private Tabular Latent Diffusion Model | literature_1f52953dd29c9d386f9706d4 | 2 / 64 | 3 / 34 | true → true | attacks, latent, original |
| Modern techniques for the detection and prevention of web2.0 attacks | literature_cc7aa023fb0f7c0d588eaa3a | 3 / 64 | 4 / 34 | true → true | attacks, content, user |
| DetectZoo: A Unified Toolkit for AI-Generated Content Detection Across Text, Audio, and Image Modalities | literature_e20d0e327ed39be5f8ae1fac | 4 / 64 | 6 / 34 | true → false | content, generated, original |
| A Comprehensive Survey of AI-Generated Content (AIGC): A History of Generative AI from GAN to ChatGPT | literature_039a5b225047a6ab57713ac0 | 5 / 54 | 7 / 24 | true → false | content, generated |
| Multi-Modal Deep Learning for Image Forgery Detection: A Synergistic Fusion Approach Combining Visual Artifacts and Metadata Consistency Analysis | literature_29b81122f2828b12aeae7ed5 | 6 / 54 | 8 / 24 | false → false | forgery, generated |
| Towards user-oriented privacy for recommender system data: A personalization-based approach to gender obfuscation for user profiles | literature_cd240711702673886b4a0005 | 7 / 54 | 9 / 24 | false → false | original, user |
| Detection of real-time deep fakes and face forgery in video conferencing employing generative adversarial networks | literature_d5bdf31c9d14e88e389c2fe4 | 8 / 54 | 5 / 34 | false → true | forgery, content, generated |
| SWT-augmented adaptive spread-spectrum watermarking in diffusion latents | literature_f9a05dbe5f39a229264fb448 | 9 / 54 | 1 / 44 | false → true | attacks, content, generated, latent |
| The Evolution of Digital Image Forgery Detection: A Comprehensive Bibliometric Review, Trends, and Future Prospects | literature_235a9cfa55d6798930b53ec2 | 10 / 44 | 13 / 14 | false → false | forgery |
| A side-channel attack for recovering keys in HMAC-SM3 algorithm | literature_79201e5031402f3b03101295 | 11 / 44 | 15 / 14 | false → false | attacks |
| Image Inpainting Forgery Detection: A Review | literature_c1faf93adacc4958999122a3 | 12 / 44 | 17 / 14 | false → false | forgery |
| Adversarial Attacks for Good: A Survey of Proactive Protection across the Visual Content Lifecycle | literature_cd6761fd996768a01c4b12f7 | 13 / 44 | 10 / 24 | false → false | attacks, content |
| Beneath the Attack Surface | literature_952fda920831445af5057c86 | 14 / 43 | 20 / 13 | false → false | attacks |
| A comprehensive survey on IoT attacks: Taxonomy, detection mechanisms and challenges | literature_7a9763c5758526da22d43501 | 15 / 34 | 16 / 14 | false → false | attacks |
| FakeShield: Explainable Image Forgery Detection and Localization via Multi-modal Large Language Models | literature_dfea7c84ff3e8de3ef6d357c | 16 / 34 | 11 / 24 | false → false | forgery, content |
| Scale-based clustering with latent variables | literature_57bc2a29cc5fce28464403a9 | 17 / 33 | 12 / 23 | false → false | latent, representation |
| Image Forgery Detection with Focus on Copy-Move: An Overview, Real World Challenges and Future Directions | literature_5f7a3e8ac189ff24d39f78f7 | 18 / 24 | 14 / 14 | false → false | forgery |
| SoC It to EM: ElectroMagnetic Side-Channel Attacks on a Complex System-on-Chip | literature_e8e7318bad7b4920cd971797 | 19 / 14 | 18 / 14 | false → false | attacks |
| Browser cross-origin timing attacks | literature_59947a2b715f417e5a58fc9c | 20 / 13 | 19 / 13 | false → false | attacks |

## query_a0dbca3b483ee2dd26900d7c

Retrieval need: retrieval_need_819ddaec3db441b6c1ef98c4

Query: reported operator verification and traceability performance

Normalized tokens: reported, operator, verification, traceability, performance

Removed stopwords: and

UPSTREAM_QUERY_QUALITY_WARNING: operator verification/traceability lacks watermarking/domain anchors; normalization cannot supply them.

Old top-k: literature_541277c4dd044688cf805a45, literature_c68e8049429d3c3abde565df, literature_0b92c5303fb370123b1200ab, literature_3eb077b738f28b000f383125, literature_445e69de54728ee6ecbf5e6e

New top-k: literature_541277c4dd044688cf805a45, literature_0b92c5303fb370123b1200ab, literature_445e69de54728ee6ecbf5e6e, literature_6366187c79ddbb8f7d603636, literature_6624408a5c23c6bffb956dd7

| Candidate | ID | Old rank / score | New rank / score | Selection old → new | New matched tokens |
|---|---|---:|---:|---|---|
| Impact of the Threshold on the Performance Verification of Computerized Tomography Scanners | literature_541277c4dd044688cf805a45 | 1 / 44 | 1 / 34 | true → true | verification, traceability, performance |
| Case studies of thermal energy storage (TES) systems: Evaluation and verification of system performance. Final report | literature_c68e8049429d3c3abde565df | 2 / 44 | 8 / 24 | true → false | verification, performance |
| ReasonOps: Operator Segmentation for LLM Reasoning Traces | literature_0b92c5303fb370123b1200ab | 3 / 34 | 2 / 24 | true → true | operator, performance |
| Self-Reports Are Not Verification: Environment-Grounded Auditing of LLM Operators in Evolutionary Search | literature_3eb077b738f28b000f383125 | 4 / 34 | 11 / 14 | true → false | verification |
| Performance Verification of the AmpereOne CPU Core | literature_445e69de54728ee6ecbf5e6e | 5 / 34 | 3 / 24 | true → true | verification, performance |
| Guidelines for checking performance and verifying accuracy of rotational rheometers: viscosity measurements in steady and oscillatory shear (IUPAC Technical Report) | literature_6366187c79ddbb8f7d603636 | 6 / 34 | 4 / 24 | false → true | verification, performance |
| Workflow Trace Profiling and Execution Time Analysis in Quantitative Verification | literature_6624408a5c23c6bffb956dd7 | 7 / 34 | 5 / 24 | false → true | verification, performance |
| Dissecting the Performance of Satellite Network Operators | literature_68d87305c0ccea5bc228a9bb | 8 / 34 | 12 / 14 | false → false | performance |
| Effects of Visual Display and Motion System Delays on Operator Performance and Uneasiness in a Driving Simulator | literature_759a7b216c81ac372ad36a09 | 9 / 34 | 6 / 24 | false → false | operator, performance |
| Advances in the metrological traceability and performance of X-ray computed tomography | literature_8cf6d6bd4b3eac31b75dfa22 | 10 / 34 | 7 / 24 | false → false | traceability, performance |
| The Performance of Nuclear Reactor Operators | literature_c8d8961ffd930477348d19da | 11 / 34 | 13 / 14 | false → false | performance |
| Dissecting the Performance of Satellite Network Operators | literature_eb895a410618dfccb317bd5a | 12 / 34 | 16 / 14 | false → false | performance |
| Task-Calibrated Operational Performance Indicators: A Fusion Framework for Aviation and Unmanned Aircraft System Operator State | literature_fe4b355123cd28b428692e41 | 13 / 34 | 9 / 24 | false → false | operator, performance |
| SIMULATOR EXPERIMENTS: EFFECTS OF NPP OPERATOR EXPERIENCE ON PERFORMANCE | literature_a936fc3c48d8d1b2615a2bf9 | 14 / 33 | 10 / 23 | false → false | operator, performance |
| The pitfalls of verifying floating-point computations | literature_71b25c720f909e5a83549754 | 15 / 24 | 19 / 4 | false → false | (none) |
| VeryTrace: Verifying Reasoning Traces through Compilable Formalism and Structured Verification | literature_dbc6d61e2392127fc7ac26cc | 16 / 24 | 14 / 14 | false → false | verification |
| A Systematic Inspection Approach to Verifying and Validating Formal Specifications based on Specification Animation and Traceability | literature_ddf6e5dbe1195b190c58ad8f | 17 / 24 | 15 / 14 | false → false | traceability |
| Techniques for formal verification of concurrent and distributed program traces | literature_f5177fd8bb711bbec85d415b | 18 / 23 | 18 / 13 | false → false | verification |
| FOL-Traces: Verified First-Order Logic Reasoning Traces at Scale | literature_e80cbc6adbc0c25c0a015eb6 | 19 / 14 | 20 / 4 | false → false | (none) |
| Generating error traces from verification-condition counterexamples | literature_eda7d1d0a6bc5d97be011645 | 20 / 14 | 17 / 14 | false → false | verification |

## Interpretation and remaining limitations

The patch removes function-word, duplicate-token and substring points only. It does not establish scientific relevance, restore omitted query context, resolve morphology, add phrase matching, or suppress scientifically broad terms.

The Q12 operator-verification query remains an UPSTREAM_QUERY_QUALITY_WARNING. No domain anchors are invented, and no score threshold empties its candidate path.

Full score decompositions, input artifact SHA-256 hashes, per-candidate rank changes, and the benchmark outcome classification are in the companion JSON. Representative audit annotations are in source-select-regression.json.
