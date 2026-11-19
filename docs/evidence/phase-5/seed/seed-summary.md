# Demo seed summary

_Generated 2026-11-19T04:01:36.246Z by `pnpm --filter @vouch/scripts seed:demo` against https://api-production-902bc54c.up.railway.app. Complete: **yes**._

Vouch `0xF4B641dc628de05336aa983B07D5d181254ff08e` on Arc Testnet (5042002). Dashboards: replace `<WEB_URL>` with the deployed web origin if it is still a placeholder.

## Venues

| Venue | Rate | Min order | Owner | Address | Dashboard | Verified | Payments | Gross | Rewards paid | Cost / new customer | Edges |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Lena's café | 15% | $1.00 | Lena | `0x9a40C2b1Da073Fea51A63B92f868A78969c56289` | https://vouch-ubc.vercel.app/venue/0x9a40C2b1Da073Fea51A63B92f868A78969c56289 | 6 | 7 | $28.00 | $3.713998 | $0.618999 | 20 |
| Kiln Bakery | 12% | $3.00 | Tomás | `0xDbf2Ffc4fdD279c4D32e99b03B6C6abC2D1fA494` | https://vouch-ubc.vercel.app/venue/0xDbf2Ffc4fdD279c4D32e99b03B6C6abC2D1fA494 | 5 | 5 | $17.10 | $1.6272 | $0.32544 | 12 |
| Pressed | 20% | $1.00 | Maya | `0x82891F492E93192F1b5cd3cEF48f6C0B56D56b4c` | https://vouch-ubc.vercel.app/venue/0x82891F492E93192F1b5cd3cEF48f6C0B56D56b4c | 4 | 4 | $14.60 | $2.696572 | $0.674143 | 12 |

## Personas

| Name | Address | Role | Balance now |
|---|---|---|---|
| Lena | `0x7e86848d2C83dadb6FcFCf109151F7d494d0c4A7` | owns Lena's café | $1.663777 |
| Tomás | `0x986d5563926198EC4F91Fa2C613230A1C0501eAC` | owns Kiln Bakery | $0.145 |
| Maya | `0x0e75C354303737ac72277E7b9c1567423aB53bDC` | owns Pressed | $6.066135 |
| Marco | `0x09b9d2183E61E5a358b0Afbec5168EFD05C0CE82` | café regular, seed ambassador at Lena's | $0.549463 |
| Sofia | `0x9d6B03aA6cf604844ff2b5a3b81e2d30B3a19e7a` | runs the book club, seed ambassador at Lena's | $0.093 |
| Ana | `0x995bb0a8f8dC85b3A1DAEadd0E2f5Ece5bb4d26F` | brought Ben in (canonical) | $0.489 |
| Priya | `0xF0667B5fDC2aDA4082D51fbA8Eaab7BA32e80434` | Ben's coworker, group-chat link (canonical) | $0.00 |
| Ben | `0x5d7195ffbF93303E8f1fb213433D658a89d3D794` | pays $12.00 (canonical) | $0.737 |
| Chloe | `0x8800448618CE1F7700b80858b25Ed7AeD9152c63` | Ben's flatmate | $0.816327 |
| Diego | `0xe4d0Bc409544495975F7c419bB7e30D8616Cb34E` | runs the Saturday run club, seed ambassador at Pressed | $0.857995 |
| Hana | `0x39295eFcB9b82FDB0D4B1e9a7fC3Fdab1DBe9A6D` | neighbourhood board, seed ambassador at Kiln | $0.441 |
| Omar | `0x24c9F01AfE4942D70Aeb44f9073B1f4a1933AfEC` | Kiln regular | $0.399 |
| Yuki | `0xaA22EA30846d4807E11bf6C0264C755466aEE30E` | Omar's neighbour | $0.3936 |

## Canonical payment (Ben, $12.00 at Lena's café)

Tx `0x83214e735269dc32850d18381fb229e8406fdbd5ea0ee4b9f85c1a73f071f980` (block 72958157), checked from the receipt's USDC `Transfer` logs: **EXACT**.

| From | To | Amount |
|---|---|---|
| Ben | Vouch | 12.00 |
| Vouch | Ben | 0.45 |
| Vouch | Ana | 0.693 |
| Vouch | Priya | 0.297 |
| Vouch | Marco | 0.252 |
| Vouch | Sofia | 0.108 |
| Vouch | Lena | 10.20 |

RewardPaid: C:Ben:450000 · L1:Ana:693000 · L1:Priya:297000 · L2:Marco:252000 · L2:Sofia:108000. PaymentSettled venueAmount 10.20, weightsMode 1 (ATTRIBUTOR); sent by the relayer: true.

## Payments

| Venue | Customer | Amount | What | Kind | Weights | Settled (Streams) | Tx |
|---|---|---|---|---|---|---|---|
| Lena's café | Ana | $2.80 | Flat white + almond croissant | rewarded | Marco 10000 | yes (0s) | `0x55da2af6f0aa2d51c7ec379379184d36a099b1207d9db6081e198f7bfa81a01e` |
| Lena's café | Priya | $2.40 | Chai latte | rewarded | Sofia 10000 | yes (0s) | `0xa6691f9f80d964c40b6e826d910ba0b5fb805bb3cc6c75bd81539852de6af0a7` |
| Lena's café | Ben | $12.00 | Lunch: soup, sandwich, cortado | **canonical** | Ana/Priya 7000/3000 | yes (0s) | `0x83214e735269dc32850d18381fb229e8406fdbd5ea0ee4b9f85c1a73f071f980` |
| Lena's café | Ben | $2.20 | Espresso to go | repeat | — | yes (0s) | `0xcee85f7d8458e9ed54ead355c7632db2b581d1ef34b6e8aefc6c16ae0817f7dd` |
| Lena's café | Chloe | $3.10 | Oat cappuccino | rewarded | Ben 10000 | yes (0s) | `0xafdd0c7a79b52b5fc0ca0b9acaf894f92ff032e3bffebd4091146dc4d5c77213` |
| Lena's café | Diego | $3.60 | Iced latte + banana bread | rewarded | Priya/Ana 3846/6154 | yes (1s) | `0x616592ac654557e57d445f2cbba007777de7f5c151de665df93139d6de0b009f` |
| Kiln Bakery | Omar | $4.80 | Sourdough loaf + morning bun | rewarded | Hana 10000 | yes (0s) | `0x57313dd6be10ba6ad455642d6a46913f60424fa72817c0552d9ee1a72756b2e9` |
| Kiln Bakery | Yuki | $3.60 | Seeded rye | rewarded | Hana/Omar 2500/7500 | yes (0s) | `0xa547bb1cee82456bf2688f52173f3109a19bfc43f02054c8c8116009aa827d4f` |
| Kiln Bakery | Priya | $2.40 | Cinnamon bun (under the $3 minimum) | below_min | — | yes (1.1s) | `0x18ba81814ec565b5bed6543d2cc73505d476d7094ae73d12ee7d2a1c03565fa0` |
| Kiln Bakery | Lena | $3.20 | Baguettes for the café | rewarded | Yuki 10000 | yes (1s) | `0x61be6cfacb5c2afe5fac642b3c9f704146ba6c4d91d6869799686de207e0889d` |
| Kiln Bakery | Sofia | $3.10 | Focaccia slab | rewarded | Lena 10000 | yes (0s) | `0xae6bdf1e911100138c94055e54a5f02e55e5a77de1e627d027bf2d6d75789cea` |
| Pressed | Chloe | $4.50 | Green juice + acai bowl | rewarded | Diego 10000 | yes (1.1s) | `0xdf281287ce73f7d88ee3c46b39c18453e6cb01c4601b202d0afa29e6f9fdcd2f` |
| Pressed | Ben | $3.80 | Mango smoothie | rewarded | Diego/Chloe 2857/7143 | yes (0s) | `0x0997c294e53cb59ee27065478106efcd9d1f02aaa69765c49cf971af42521dad` |
| Pressed | Ana | $3.40 | Beet + ginger shot pack | rewarded | Ben 10000 | yes (0s) | `0x6b1c008bf35b2a69e53dfe44c41ef9459b498a9186c782408fd7dfd8a54432f5` |
| Pressed | Tomás | $2.90 | Carrot-orange juice | rewarded | Ana 10000 | yes (0s) | `0x94c44d6511a569e6b760b4c28608cd71fed67881d708e69b7226497aec18c25e` |
| Lena's café | Maya | $1.90 | Drip coffee | rewarded | Chloe 10000 | yes (0s) | `0xf9c79894048cb3aaa0bf65bfb6bec8f0f54f851c23d5f3e490bc50cd136f708b` |

## Spend

- Payment volume: $59.70 (stays in demo wallets: venue revenue + rewards)
- Funded from DEPLOYER (topup CLI): $12.675849
- Recycled from seed venue revenue: $42.282062 (transfer gas $0.02455135)
- Relayer gas: $0.243275325 for 42 relayed txs

## Funding transfers

| To | From | Amount | Tx |
|---|---|---|---|
| Ana | DEPLOYER (topup CLI) | $2.80 | `0xc07b60079b709e7dacdff85a135e8d89f0cf1b8d8b45f411a1a9b9dbef6daac9` |
| Priya | Lena | $2.40 | `0xee19cb7ca8fa49c523fc23b309451d421801d56be638047f58d339fc2843eb2c` |
| Ben | Lena | $2.124151 | `0x88ab01c121235365586ec60585c6896c16c55bca682254a9c2a5ffd917483108` |
| Ben | DEPLOYER (topup CLI) | $9.875849 | `0x474f5dacd6b449d5aa96998f5f1974ff31ae692fd7917525e15ae303f3dd2d3b` |
| Ben | Lena | $1.75 | `0x1ecc8a6e7e67ef0b175159f182a8b0a4f3307be19813c14e9af6bd90dae3e426` |
| Chloe | Lena | $3.10 | `0x97986f4f9efe796d6a05c8b91f3a38f6e31fddf6c1c5a1ea6d16f3a3b52bf11f` |
| Diego | Lena | $3.60 | `0xba1545ea23ddf8d1197e591a15a2b963862faeb8c2be84d590a1c2d4b0689434` |
| Omar | Lena | $4.80 | `0x515592265d39039372aeca531e6948fe3d1cca7efc687123d60fac07157cdc43` |
| Yuki | Lena | $3.60 | `0x0fb0920f8b816f5cbdd63b69e1d81702613943d584670b5e7eb2f7755c456f12` |
| Priya | Lena | $1.234535 | `0x457beb3b2479acbbd41878f1dc46dc3a15f5b3b4612e9f44c1dd8726579eb377` |
| Priya | Tomás | $0.664239 | `0xfcfd70857aea4c75f46059d83a72e65502761ea18caa5ea014fe76cfe8be60d2` |
| Lena | Tomás | $3.151223 | `0x6744d680d882093efe1436041f8d92a5999d9c89cc5c7adccb4b72048730289b` |
| Sofia | Tomás | $2.752464 | `0xcbd8365019ca5e6e7b604e4429ec3d38e86257900d764f5dc7080fa3342e6cb5` |
| Chloe | Lena | $0.2506 | `0xda7022049b6a67b5228e9f94cc7e839c9d468cac7147cab6d85dffd20565aa22` |
| Chloe | Tomás | $4.13315 | `0x8917de8d41360b9c751ef11875b8c4dd6f5c71eb5936b81e9c88f5e3641d1149` |
| Ben | Tomás | $3.54425 | `0xd37c69bd5f909784bb92282020eac9f256b6c79decd99f582106508022c2d54e` |
| Ana | Tomás | $1.171355 | `0x42cef444ef9babf0e3ddee535cdf84003d38e5c2d38b58a88d1a4935b0b214ec` |
| Ana | Maya | $1.154872 | `0x912307f62834a8bce10c5053d5b8d1051118e4a7f93e4bcfc47c4c94b7961d38` |
| Tomás | Maya | $2.851223 | `0xc126959b2e2b03a8fcaab04522357bc4a8ee487ac8c963af5d9d97cfaf8c5536` |

## Relayed transactions

| What | Tx | Gas |
|---|---|---|
| registerVenue Lena's café | `0x73dcb0f14ad6fbceb876cc0e2360d9753fe70212ac73ee9e7f7751cdeb025140` | 0.004484225 |
| setSeedAmbassador Marco @ Lena's café | `0x0604ca367f0a44a16df39ef0df5e5b344ed2d7d62c52b380eb39094dddf767a5` | 0.001588625 |
| setSeedAmbassador Sofia @ Lena's café | `0xceda087baae6d9f2def7bd3f61926b7f090684f9238119b5f394fa0b012b44f5` | 0.001588625 |
| acceptIntro Marco→Ana @ Lena's café (personal, 1 opens) | `0xada2a4cd19e65922161744d34151f31cc2bdbc623e37ca7bdd6f0a468c8fb144` | 0.0043265 |
| pay Ana $2.80 @ Lena's café | `0x55da2af6f0aa2d51c7ec379379184d36a099b1207d9db6081e198f7bfa81a01e` | 0.010341325 |
| acceptIntro Sofia→Priya @ Lena's café (personal, 1 opens) | `0x089f7564e358393e2d63c5792dc1cc5e89fb1a4be91132bf09831cd810669303` | 0.0043265 |
| pay Priya $2.40 @ Lena's café | `0xa6691f9f80d964c40b6e826d910ba0b5fb805bb3cc6c75bd81539852de6af0a7` | 0.008860325 |
| acceptIntro Ana→Ben @ Lena's café (personal, 3 opens) | `0x7773fd82a294c7cad78f5e6f9e5e43834d15d60e1a787cacd1d4d96f5a926c43` | 0.00426925 |
| acceptIntro Priya→Ben @ Lena's café (broadcast, 2 opens) | `0xc836988a3c5096fca4ccd32adfec2b25dd6c905e067963082ab6ad95154b0971` | 0.0039609 |
| pay Ben $12.00 @ Lena's café (CANONICAL) | `0x83214e735269dc32850d18381fb229e8406fdbd5ea0ee4b9f85c1a73f071f980` | 0.012357825 |
| pay Ben $2.20 @ Lena's café (repeat) | `0xcee85f7d8458e9ed54ead355c7632db2b581d1ef34b6e8aefc6c16ae0817f7dd` | 0.00433135 |
| acceptIntro Ben→Chloe @ Lena's café (personal, 2 opens) | `0x28c8a737ccd84d61a9d59e01a2371a31591af0d0abfe1d439130a409ff406984` | 0.00426895 |
| pay Chloe $3.10 @ Lena's café | `0xafdd0c7a79b52b5fc0ca0b9acaf894f92ff032e3bffebd4091146dc4d5c77213` | 0.009842425 |
| acceptIntro Priya→Diego @ Lena's café (broadcast, 1 opens) | `0xf63f37e21cbbc813b2de693c4aee4f678f08b7970babaebe281037d912a99db1` | 0.004274175 |
| acceptIntro Ana→Diego @ Lena's café (personal, 0 opens) | `0xd5317dfbd41359ea50bcab54046c04fdd4b53201b1fbb0f86a560d23382dc91d` | 0.003956275 |
| pay Diego $3.60 @ Lena's café | `0x616592ac654557e57d445f2cbba007777de7f5c151de665df93139d6de0b009f` | 0.009607225 |
| registerVenue Kiln Bakery | `0x3cf21f042eb9dbdf718fcfd065fcdbfaf7ea9682491cf8df2699f8179d59ff8f` | 0.004484225 |
| setSeedAmbassador Hana @ Kiln Bakery | `0x061cbcb66d23d74958f37145481765f7a37adb22b90a936401825a82c25295af` | 0.001588625 |
| acceptIntro Hana→Omar @ Kiln Bakery (broadcast, 1 opens) | `0xcbe3d5284cc6f89d8cad44d558dcb4452fa3d46625231454fa6997bd3dd7da9f` | 0.004331425 |
| pay Omar $4.80 @ Kiln Bakery | `0x57313dd6be10ba6ad455642d6a46913f60424fa72817c0552d9ee1a72756b2e9` | 0.010340725 |
| acceptIntro Hana→Yuki @ Kiln Bakery (broadcast, 0 opens) | `0x0a1d56a633de4e8b9bc0165bad4a9376770379b946eeabd06412377f1dded535` | 0.004331725 |
| acceptIntro Omar→Yuki @ Kiln Bakery (personal, 2 opens) | `0x617964e9a0d1a751e91371dad275b8b4b15653289f1bac732624796dc58f7e19` | 0.003955675 |
| pay Yuki $3.60 @ Kiln Bakery | `0xa547bb1cee82456bf2688f52173f3109a19bfc43f02054c8c8116009aa827d4f` | 0.010315425 |
| acceptIntro Omar→Priya @ Kiln Bakery (personal, 1 opens) | `0x365cda6139fe6ebb527e606c7003799695a6aab079bed239bc3805a9152bde8a` | 0.00426925 |
| pay Priya $2.40 @ Kiln Bakery (below minimum) | `0x18ba81814ec565b5bed6543d2cc73505d476d7094ae73d12ee7d2a1c03565fa0` | 0.004709575 |
| acceptIntro Yuki→Lena @ Kiln Bakery (personal, 1 opens) | `0xc231c73bad3959a81fd1d805a8b141657fa24c6ea0bbf36173aa380015ec16a0` | 0.00426925 |
| pay Lena $3.20 @ Kiln Bakery | `0x61be6cfacb5c2afe5fac642b3c9f704146ba6c4d91d6869799686de207e0889d` | 0.008592825 |
| acceptIntro Lena→Sofia @ Kiln Bakery (personal, 1 opens) | `0x0ac4d94aaed5063e8d246c637bb277ea4a58c51b7a1da559d7105dfc0414eba3` | 0.00426925 |
| pay Sofia $3.10 @ Kiln Bakery | `0xae6bdf1e911100138c94055e54a5f02e55e5a77de1e627d027bf2d6d75789cea` | 0.009217525 |
| registerVenue Pressed | `0x5343d9ffa33f6f6afd56cc1231b64c63d34bde08a34c4ba459327353c8d09cc1` | 0.004482425 |
| setSeedAmbassador Diego @ Pressed | `0x33d76e76ebaa6b3db649651305c187e697a4d7cbd81ed6cd63836dcae809dc6b` | 0.001588625 |
| acceptIntro Diego→Chloe @ Pressed (personal, 2 opens) | `0x1527c6eff46140eb0366d3b259e8043742296d070dc474bb6ec02adbf8e791bc` | 0.0043259 |
| pay Chloe $4.50 @ Pressed | `0xdf281287ce73f7d88ee3c46b39c18453e6cb01c4601b202d0afa29e6f9fdcd2f` | 0.009715125 |
| acceptIntro Diego→Ben @ Pressed (broadcast, 0 opens) | `0xe49474c2ffd378d6793197ed0a77695206230fed1406ca6942cf0ed3bab7e9e5` | 0.004331725 |
| acceptIntro Chloe→Ben @ Pressed (personal, 1 opens) | `0x7bd270519f2d5ab49405f60f9c99e41207a25c4a971d2928689f8c3a6ef5ece9` | 0.003955375 |
| pay Ben $3.80 @ Pressed | `0x0997c294e53cb59ee27065478106efcd9d1f02aaa69765c49cf971af42521dad` | 0.010314525 |
| acceptIntro Ben→Ana @ Pressed (personal, 1 opens) | `0x9e41f0b71d1ea04ac8d54bd6a8c251bf83e529c5922fb3e0ad9d98a1f543e6fa` | 0.00426925 |
| pay Ana $3.40 @ Pressed | `0x6b1c008bf35b2a69e53dfe44c41ef9459b498a9186c782408fd7dfd8a54432f5` | 0.008791125 |
| acceptIntro Ana→Tomás @ Pressed (personal, 1 opens) | `0x38bd9d83e0b94b8f7cf3e4ff8afc9e69fd85db15914010378bf7e4aee790532a` | 0.00426925 |
| pay Tomás $2.90 @ Pressed | `0x94c44d6511a569e6b760b4c28608cd71fed67881d708e69b7226497aec18c25e` | 0.008166425 |
| acceptIntro Chloe→Maya @ Lena's café (personal, 1 opens) | `0x82d71e1058cf76f12a7b0d3fdf7f0a2bb7a2b9a126e2d900afd56772e14dc609` | 0.00426835 |
| pay Maya $1.90 @ Lena's café | `0xf9c79894048cb3aaa0bf65bfb6bec8f0f54f851c23d5f3e490bc50cd136f708b` | 0.007737225 |

## Lena's café: hosted feed (`/venues/0x9a40C2b1Da073Fea51A63B92f868A78969c56289/payments`)

- Maya paid $1.90 → venue $1.615, back $0.07125; L1 Chloe 0.15675, L2 Ben 0.057
- Diego paid $3.60 → venue $3.060002, back $0.135; L1 Priya 0.114226, L1 Ana 0.182773, L2 Sofia 0.041536, L2 Marco 0.066463
- Chloe paid $3.10 → venue $2.635, back $0.11625; L1 Ben 0.25575, L2 Ana 0.093
- Ben paid $2.20 → venue $2.20 (repeat)
- Ben paid $12.00 → venue $10.20, back $0.45; L1 Ana 0.693, L1 Priya 0.297, L2 Marco 0.252, L2 Sofia 0.108
- Priya paid $2.40 → venue $2.112, back $0.09; L1 Sofia 0.198; returned $0.072
- Ana paid $2.80 → venue $2.464, back $0.105; L1 Marco 0.231; returned $0.084

Edges (`/stats`): L0 Ana→Ana 0.105 · L1 Ana→Marco 0.231 · L0 Priya→Priya 0.09 · L1 Priya→Sofia 0.198 · L0 Ben→Ben 0.45 · L1 Ben→Ana 0.693 · L1 Ben→Priya 0.297 · L2 Ana→Marco 0.252 · L2 Priya→Sofia 0.108 · L0 Chloe→Chloe 0.11625 · L1 Chloe→Ben 0.25575 · L2 Ben→Ana 0.093 · L0 Diego→Diego 0.135 · L1 Diego→Priya 0.114226 · L1 Diego→Ana 0.182773 · L2 Priya→Sofia 0.041536 · L2 Ana→Marco 0.066463 · L0 Maya→Maya 0.07125 · L1 Maya→Chloe 0.15675 · L2 Chloe→Ben 0.057

## Kiln Bakery: hosted feed (`/venues/0xDbf2Ffc4fdD279c4D32e99b03B6C6abC2D1fA494/payments`)

- Sofia paid $3.10 → venue $2.728, back $0.093; L1 Lena 0.2046, L2 Yuki 0.0744
- Lena paid $3.20 → venue $2.816, back $0.096; L1 Yuki 0.2112, L2 Omar 0.0768
- Priya paid $2.40 → venue $2.40
- Yuki paid $3.60 → venue $3.1896, back $0.108; L1 Hana 0.0594, L1 Omar 0.1782, L2 Hana 0.0648; returned $0.0216
- Omar paid $4.80 → venue $4.3392, back $0.144; L1 Hana 0.3168; returned $0.1152

Edges (`/stats`): L0 Omar→Omar 0.144 · L1 Omar→Hana 0.3168 · L0 Yuki→Yuki 0.108 · L1 Yuki→Hana 0.0594 · L1 Yuki→Omar 0.1782 · L2 Omar→Hana 0.0648 · L0 Lena→Lena 0.096 · L1 Lena→Yuki 0.2112 · L2 Yuki→Omar 0.0768 · L0 Sofia→Sofia 0.093 · L1 Sofia→Lena 0.2046 · L2 Lena→Yuki 0.0744

## Pressed: hosted feed (`/venues/0x82891F492E93192F1b5cd3cEF48f6C0B56D56b4c/payments`)

- Tomás paid $2.90 → venue $2.32, back $0.145; L1 Ana 0.319, L2 Ben 0.116
- Ana paid $3.40 → venue $2.72, back $0.17; L1 Ben 0.374, L2 Chloe 0.136
- Ben paid $3.80 → venue $3.083428, back $0.19; L1 Diego 0.119422, L1 Chloe 0.298577, L2 Diego 0.108573; returned $0.043426
- Chloe paid $4.50 → venue $3.78, back $0.225; L1 Diego 0.495; returned $0.18

Edges (`/stats`): L0 Chloe→Chloe 0.225 · L1 Chloe→Diego 0.495 · L0 Ben→Ben 0.19 · L1 Ben→Diego 0.119422 · L1 Ben→Chloe 0.298577 · L2 Chloe→Diego 0.108573 · L0 Ana→Ana 0.17 · L1 Ana→Ben 0.374 · L2 Ben→Chloe 0.136 · L0 Tomás→Tomás 0.145 · L1 Tomás→Ana 0.319 · L2 Ana→Ben 0.116
