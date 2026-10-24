# Changelog

## [0.7.0](https://github.com/mimukit/saasaloy/compare/v0.6.1...v0.7.0) (2026-10-24)

### ⚠ BREAKING CHANGES

* **template:** a database-d1 project no longer migrates production on every
  deploy. pnpm deploy:production stops at its migration gate when a migration
  file changed since the last deploy tag, and migrates only with --migrate.
  The D1 script db:migrate:prod is renamed db:prod:migrate.

  An existing project takes the gated deploy with `saasaloy update`, then:

    - take packages/tooling (update creates it; deploy.config.ts and
      targets.ts are the project's after that)
    - merge the root package.json scripts: deploy:production, prepare,
      skills:link, lint:types and lint:fix
    - merge turbo.json: drop ^db:migrate:prod from deploy and the
      db:migrate:prod task
    - with database-d1, rename db:migrate:prod in packages/db/package.json
      to db:prod:migrate if the update did not add it
    - run `saasaloy doctor` and fix its two Deploy warnings, if shown
    - add a custom_domain route to each Worker with a production host, so
      its smoke checks run

  The steps are also in the saasaloy-deploy skill under "A project made
  before the gated deploy". update does not create docs/runbook-deploy.md,
  a seed file; copy it from a new project.
* **template:** a project made before the release step takes it with
  `saasaloy update`, then finishes by hand:

    - merge the root package.json scripts: release is
      `node packages/tooling/src/release.ts`, and release:dry is the same
      with --dry-run (update writes them when the file was not edited)
    - delete an older .release-it.json and any root release-it or
      @release-it/conventional-changelog devDependency; release.ts reads
      neither, so move a changelog choice into the release block of
      packages/tooling/src/deploy.config.ts
    - keep CHANGELOG.md and the v* tags; the next release adds its entry
      above the old ones
    - run `saasaloy doctor`; it warns while the release script is missing

  The root package.json version now belongs to the project: update keeps
  it, and a release alone never sends the file to the merge plan. The
  steps are also in the saasaloy-deploy skill under "A project made
  before the release step".
* **api-keys:** api-keys is now a core that needs an owner module,
  api-keys-organization or api-keys-user. In a project that installed
  api-keys before this change, saasaloy update now refuses with exit 2,
  names both owners, and changes nothing until one is installed. The
  existing keys are organization-owned, so pick api-keys-organization.
  Upgrade the saasaloy CLI first, because the new api-keys descriptor
  requires it and an older CLI refuses it. Then run
  `saasaloy add api-keys-organization`, which adopts the schema, the
  resolver, the screen and the plugin as they are, and then run
  `saasaloy update`. The api_keys table does not change, and
  db:generate reports no schema changes.
* **billing:** modules/entitlements no longer exists. Install
  billing instead. An existing project runs 'saasaloy remove
  entitlements' then 'saasaloy add billing --force'; remove builds its
  plan from the local manifest, so it still works.
* **modules:** the rbac module no longer exists. An existing
  project runs `saasaloy remove rbac`, then `saasaloy add
  multitenant`. The subpaths @repo/auth/rbac and
  @repo/auth/rbac-rules become @repo/auth/permissions and
  @repo/auth/permission-rules, and requireCan becomes
  requirePermission.
* **auth:** the session cookies are renamed to client.session_token
  and admin.session_token, so every existing session ends and users sign
  in again. A project made before this change runs saasaloy update auth
  admin, resolves auth.ts, client.ts, server.ts and the auth schema in the
  merge plan, runs pnpm db:generate and applies the migration that adds
  sessions.audience, then runs saasaloy update for each module that
  patches auth (teams, rbac, api-keys, billing-stripe). A route of its own
  that calls auth.api.* switches to authFor(c).api.* when the admin app
  calls it, and a middleware on /admin/* must skip /admin/auth/*.
* **testing:** the six module test files that shipped
  unconditionally (auth.test.ts, health-db.test.ts,
  completeness.test.ts, dump.test.ts, production.test.ts and
  files.test.ts) now ship only when testing is on. A project with
  testing off, or with no testing key, no longer receives them on
  add. Run `saasaloy testing tests-after` to get them back.

### Features

* **admin:** add status pill tones and detail panel slots ([856a6d2](https://github.com/mimukit/saasaloy/commit/856a6d2ec7198a4734517c2520788c0c3318fa8b)), references [#217](https://github.com/mimukit/saasaloy/issues/217)
* **admin:** show data table rows as cards below md ([bcf8540](https://github.com/mimukit/saasaloy/commit/bcf8540cb239d900cd24bd796ca7da82cfa8e05b)), references [#217](https://github.com/mimukit/saasaloy/issues/217)
* **admin:** show live counts on nav rows ([d29adc5](https://github.com/mimukit/saasaloy/commit/d29adc5c529cf02bb539c88294ce63465910d958)), references [#217](https://github.com/mimukit/saasaloy/issues/217)
* **api-keys:** let a user own an api key, with no organization ([8b61cd0](https://github.com/mimukit/saasaloy/commit/8b61cd01ca86f99a7e385784b322d1c4b40b1e5c)), closes [#229](https://github.com/mimukit/saasaloy/issues/229)
* **auth:** build ADMIN_APP_ROLES from config on both sides ([0d85b10](https://github.com/mimukit/saasaloy/commit/0d85b1052d90a7a61805bcb7dde929ddbd0097fa)), references [#154](https://github.com/mimukit/saasaloy/issues/154)
* **auth:** give the two role strings one home in config ([e225b5c](https://github.com/mimukit/saasaloy/commit/e225b5cd2e22918fb194b51c206a862aaeea6cb3)), references [#154](https://github.com/mimukit/saasaloy/issues/154)
* **billing:** read the app name and the tier ids from config ([65b0fa3](https://github.com/mimukit/saasaloy/commit/65b0fa30711eecaf1f5ad5a9b634dc619d8d8b72)), references [#154](https://github.com/mimukit/saasaloy/issues/154)
* **cli:** answer every prompt with a flag ([52e9a75](https://github.com/mimukit/saasaloy/commit/52e9a75bc76cd14e93d5e1d19fc9579958d5b112)), references [#223](https://github.com/mimukit/saasaloy/issues/223)
* **cli:** guard the base app key and each section file's own key ([bca9e7e](https://github.com/mimukit/saasaloy/commit/bca9e7e405d58d2bd398dc0c96a4a97dd1723b19)), references [#154](https://github.com/mimukit/saasaloy/issues/154)
* **cli:** keep the project's release version through update ([0ce93ec](https://github.com/mimukit/saasaloy/commit/0ce93ec6c3dcf9aa67d27c7039bb1c928d3ef6d6)), references [#236](https://github.com/mimukit/saasaloy/issues/236)
* **cli:** link every project skill folder ([e27cc43](https://github.com/mimukit/saasaloy/commit/e27cc43fd9bddf38fc106bd89060a45e1a433a44))
* **cli:** print json for agents and describe every module ([8182952](https://github.com/mimukit/saasaloy/commit/8182952c14698bf5a4de9a6a5fac53e9d8b235cd)), references [#223](https://github.com/mimukit/saasaloy/issues/223)
* **cli:** refuse an update that leaves a module without an owner ([2f42e40](https://github.com/mimukit/saasaloy/commit/2f42e402d9ed6e45b321eecccac016434bd6b2ef)), references [#229](https://github.com/mimukit/saasaloy/issues/229)
* **cli:** refuse every prompt that has no terminal to answer it ([089083e](https://github.com/mimukit/saasaloy/commit/089083ee231fe1c9dc63e852933e31f97e083994)), references [#223](https://github.com/mimukit/saasaloy/issues/223)
* **cli:** refuse two modules claiming one config section key ([c4500e3](https://github.com/mimukit/saasaloy/commit/c4500e33d2ea99f18ce9791f6831e0c4d24ebc86)), references [#154](https://github.com/mimukit/saasaloy/issues/154)
* **config:** add the config capability to the base template ([256b822](https://github.com/mimukit/saasaloy/commit/256b8222cb177357577371c1bfb8a9095426cf01)), references [#154](https://github.com/mimukit/saasaloy/issues/154)
* **config:** ship the product name as Saasaloy ([9dc3d81](https://github.com/mimukit/saasaloy/commit/9dc3d81d08671b379f15e2c9c2d9b12ff724d2a2)), references [#191](https://github.com/mimukit/saasaloy/issues/191) [#154](https://github.com/mimukit/saasaloy/issues/154)
* **deploy:** add a release step that names each deploy ([6d7c3e6](https://github.com/mimukit/saasaloy/commit/6d7c3e690ebfa6e0d92bccd7266197a166c53a7c)), references [#236](https://github.com/mimukit/saasaloy/issues/236)
* **e2e:** add the browser suite capability ([c82365e](https://github.com/mimukit/saasaloy/commit/c82365e453731a72cbddc933eb48a2a7bc766c2e)), references [#164](https://github.com/mimukit/saasaloy/issues/164) [#155](https://github.com/mimukit/saasaloy/issues/155)
* **file-uploads:** record objects, upload UI and the public image path ([35ae909](https://github.com/mimukit/saasaloy/commit/35ae90936c1f2116ba3c88afb8742ab0e56488e0)), references [#175](https://github.com/mimukit/saasaloy/issues/175)
* **kv-upstash:** add the upstash redis provider ([3cf301b](https://github.com/mimukit/saasaloy/commit/3cf301bbc4ec8200c1e2281715044684adfe716b)), references [#135](https://github.com/mimukit/saasaloy/issues/135)
* **kv-upstash:** ship an env preset and route its keys to api ([1820493](https://github.com/mimukit/saasaloy/commit/1820493cdb9d6cf6a192d624a90e38a44e3e8b63))
* **modules:** add deploy rows, a database probe and production db commands ([16d7411](https://github.com/mimukit/saasaloy/commit/16d74110cb9c87cf7af80bea7315dbac9745c7b4))
* **payment:** move the payments page onto the admin parts ([f0d6928](https://github.com/mimukit/saasaloy/commit/f0d6928a277a33726b831c6db08b3daee640f654)), references [#217](https://github.com/mimukit/saasaloy/issues/217)
* **repo:** add an agent benchmark and its scorer ([604d611](https://github.com/mimukit/saasaloy/commit/604d611874c22a049a0e612bbf77b1537fb004aa)), references [#222](https://github.com/mimukit/saasaloy/issues/222)
* **template:** gate, order and tag the production deploy ([277db74](https://github.com/mimukit/saasaloy/commit/277db745e703542b615b9b9e34009ed48afe08f2))
* **template:** make room for the e2e workspace ([d8da5c4](https://github.com/mimukit/saasaloy/commit/d8da5c49034d804788b5a4ba63be49d4ab487b0e)), references [#155](https://github.com/mimukit/saasaloy/issues/155)
* **template:** ship the deploy skill, the runbook and skills:link ([1540dca](https://github.com/mimukit/saasaloy/commit/1540dcae8e419d9c5742c23e3612e55e7db461cc))
* **testing:** add the testing mode and its agents.md block ([3108de1](https://github.com/mimukit/saasaloy/commit/3108de12ddba8fe816755ad5310ef61ccb518472)), references [#242](https://github.com/mimukit/saasaloy/issues/242) [#242](https://github.com/mimukit/saasaloy/issues/242)
* **testing:** ship module files on a when condition ([56a26a9](https://github.com/mimukit/saasaloy/commit/56a26a9038c99609d6dfd52d61135ce31395a0cd)), references [#242](https://github.com/mimukit/saasaloy/issues/242) [#242](https://github.com/mimukit/saasaloy/issues/242)
* **testing:** ship the saasaloy-testing skill in the base ([504626d](https://github.com/mimukit/saasaloy/commit/504626d91493d4db07bafa4737d93d7b3d983c44)), references [#242](https://github.com/mimukit/saasaloy/issues/242) [#242](https://github.com/mimukit/saasaloy/issues/242)

### Bug Fixes

* **admin:** render the refusal page without the shell ([a3791a4](https://github.com/mimukit/saasaloy/commit/a3791a4aab26db907713119b7a7226399428870a)), references [#238](https://github.com/mimukit/saasaloy/issues/238)
* **admin:** stop the build from rewriting routeTree.gen.ts ([f99d51c](https://github.com/mimukit/saasaloy/commit/f99d51c042cc69ea04d9a2184e870eedbdca4351))
* **api-keys:** keep user-owned keys on the client instance ([c6ab846](https://github.com/mimukit/saasaloy/commit/c6ab8469d37772800abbfe481e56ff10f6b3a186)), references [#229](https://github.com/mimukit/saasaloy/issues/229)
* **api-keys:** let a tab after Bearer claim the key path ([d2eb4a3](https://github.com/mimukit/saasaloy/commit/d2eb4a3e4d6dc9653845965be3fb6dd11edaa920)), references [#229](https://github.com/mimukit/saasaloy/issues/229)
* **api-keys:** pin the user-owned schema to api-key 1.7.7 ([b2f6ded](https://github.com/mimukit/saasaloy/commit/b2f6dedad3f1d6a7b9aa92129b0d511899a59080)), references [#229](https://github.com/mimukit/saasaloy/issues/229)
* **api-keys:** refuse a banned owner's key in user mode ([b0c2c78](https://github.com/mimukit/saasaloy/commit/b0c2c7842c4ce52238e753781b9093a1eb31cfed)), references [#229](https://github.com/mimukit/saasaloy/issues/229)
* **auth:** key the admin plugin's roles by config's role strings ([a0a8bac](https://github.com/mimukit/saasaloy/commit/a0a8bac607007434ece093677a2c9df934585039)), references [#154](https://github.com/mimukit/saasaloy/issues/154)
* **auth:** read the seeded and displayed role names from config ([8419315](https://github.com/mimukit/saasaloy/commit/8419315e239a63fed2ef88ccc0f4f3b53e54280a)), references [#154](https://github.com/mimukit/saasaloy/issues/154)
* **auth:** separate the client and admin sessions ([8b29722](https://github.com/mimukit/saasaloy/commit/8b297221ec6675645db844d3dceb060028f1b997)), references [#238](https://github.com/mimukit/saasaloy/issues/238)
* **billing:** name the plan entitlements in the module description ([163e187](https://github.com/mimukit/saasaloy/commit/163e187c6ce1b59b70eee838bba04919c553d1c0))
* **cli:** apply the review findings on the no-tty contract ([cde3828](https://github.com/mimukit/saasaloy/commit/cde382890c8fd62296a860543412beb0de609b98)), references [#223](https://github.com/mimukit/saasaloy/issues/223)
* **cli:** count a same-slot revision as still declared in the patch take-over ([fe50873](https://github.com/mimukit/saasaloy/commit/fe508737990dbbe6134509e6852f558b46b8bfde)), references [#242](https://github.com/mimukit/saasaloy/issues/242) [#229](https://github.com/mimukit/saasaloy/issues/229)
* **cli:** move a patch only from a module that dropped it, and warn on an ownerless core ([961ec71](https://github.com/mimukit/saasaloy/commit/961ec71c32023c16ac589daf8c96ae0859629cc1)), references [#229](https://github.com/mimukit/saasaloy/issues/229)
* **cli:** name the owners when add has no terminal ([5faefee](https://github.com/mimukit/saasaloy/commit/5faefeed627a96fd1775517b063ca8c4c56659d5)), references [#229](https://github.com/mimukit/saasaloy/issues/229)
* **cli:** report a plugin-array patch whose export is missing ([0c1499a](https://github.com/mimukit/saasaloy/commit/0c1499a8481ce304159f3fedcb4c6e253b5b19ec)), references [#238](https://github.com/mimukit/saasaloy/issues/238)
* **cli:** start a new project's repository on main ([2662f1c](https://github.com/mimukit/saasaloy/commit/2662f1cc9c67b32e3969081af6092098ad40101a))
* **config:** drop the extra cast the scaffolded lint flags ([b213310](https://github.com/mimukit/saasaloy/commit/b2133101801844a3c260ec463f182c94bfac28d7)), references [#154](https://github.com/mimukit/saasaloy/issues/154)
* **config:** freeze the composed config all the way down ([9995908](https://github.com/mimukit/saasaloy/commit/99959089d1929e42a89fbf12f8092e2462c38580)), references [#154](https://github.com/mimukit/saasaloy/issues/154)
* **config:** let the scaffolded type-aware lint pass the merge tests ([104941f](https://github.com/mimukit/saasaloy/commit/104941f1eb0b3e3e4212d6689f8d116f06f14a68)), references [#154](https://github.com/mimukit/saasaloy/issues/154)
* **database-d1:** dump before every production migration ([2aa156d](https://github.com/mimukit/saasaloy/commit/2aa156dbe6cc5c3f277693a0776732922bc9b893))
* **deploy:** bump the minor for a feat below 1.0 ([990f88d](https://github.com/mimukit/saasaloy/commit/990f88d2d1304da41bdc3ae4458df8e78f7bb2eb)), references [#236](https://github.com/mimukit/saasaloy/issues/236)
* **file-uploads:** adopt main's env preset and seed slice rules ([37c0a82](https://github.com/mimukit/saasaloy/commit/37c0a8202c0914308edb329f2fde22e878c133fa))
* **file-uploads:** destructure the first validation issue ([46531f2](https://github.com/mimukit/saasaloy/commit/46531f24855e331909953f42a5eb5de19d69e170))
* **file-uploads:** pass the playground's lint and typecheck on main ([d8f5b2d](https://github.com/mimukit/saasaloy/commit/d8f5b2db50a24bfcf2975933cd6617364f8db91c))
* **file-uploads:** scope objects to their owner with no organization ([ad36308](https://github.com/mimukit/saasaloy/commit/ad3630868fd907eb126b3a94ec4096ccdc0179da))
* **kv-upstash:** read list prefixes as the contract does and retry transport failures ([35f6c2e](https://github.com/mimukit/saasaloy/commit/35f6c2e65ad9f186916197d7a0982b17a5671725))
* **kv-upstash:** treat a workerd fetch failure as a transport failure ([61032f2](https://github.com/mimukit/saasaloy/commit/61032f235534437da639c4421be0ed089fa2019c))
* **modules:** give both auth instances the feature plugins ([f4dc646](https://github.com/mimukit/saasaloy/commit/f4dc646ed492b2874b2b92ab3186e31301b0f9fd)), references [#238](https://github.com/mimukit/saasaloy/issues/238)
* **modules:** warn about custom roles on remove multitenant ([39cea69](https://github.com/mimukit/saasaloy/commit/39cea6955dbe6dbbf4808f8ba2fda9d373574fc9)), references [#167](https://github.com/mimukit/saasaloy/issues/167)
* **payment:** cast users.id to text in the admin joins ([4ba277e](https://github.com/mimukit/saasaloy/commit/4ba277ec835a7729ebb723fcabbca390aa1f7606)), closes [#221](https://github.com/mimukit/saasaloy/issues/221)
* **registry:** floor the api-keys split at the cli that refuses an ownerless update ([10961d7](https://github.com/mimukit/saasaloy/commit/10961d7c772f827ec4b42313f623f29474cfbe3d)), references [#229](https://github.com/mimukit/saasaloy/issues/229)
* **release:** cross compatible module choices ([c325786](https://github.com/mimukit/saasaloy/commit/c3257864282aa1a731d95f006987ae36952d9cbb))
* **repo:** keep the user CLAUDE.md out of the agent benchmark ([ae886a0](https://github.com/mimukit/saasaloy/commit/ae886a0b401d3936be72b03d68b14859f97c086b)), references [#222](https://github.com/mimukit/saasaloy/issues/222)
* **repo:** let the e2e playground install update its lockfile on CI ([bd55505](https://github.com/mimukit/saasaloy/commit/bd555057892fe92d5374e7f0210ad070a247a405))
* **repo:** score turbo-prefixed mail and stop the bench on any signal ([feab7f4](https://github.com/mimukit/saasaloy/commit/feab7f4c119b17ed5841543350ab417b46e5bdc3)), references [#222](https://github.com/mimukit/saasaloy/issues/222)
* **template:** correct the d1 migrate script and the services test ([a77f2f7](https://github.com/mimukit/saasaloy/commit/a77f2f7ad381fddcef2cd1735b4500ecae09b01e))
* **template:** name each dirty file whole in the deploy gate ([18541cb](https://github.com/mimukit/saasaloy/commit/18541cbfc5bdbf13400b3bed42c12fe1ac29bea1))
* **testing:** apply the review fixes to backfill and gated patches ([eff9a71](https://github.com/mimukit/saasaloy/commit/eff9a717e2f28e7065c41cc472e3b65bdc83c9a4)), references [#254](https://github.com/mimukit/saasaloy/issues/254) [#242](https://github.com/mimukit/saasaloy/issues/242) [#242](https://github.com/mimukit/saasaloy/issues/242)
* **ui:** drop the retired entitlements module from the landing lists ([332b597](https://github.com/mimukit/saasaloy/commit/332b597f79ccc18ae65d784d84caf93b1a158bed)), references [#165](https://github.com/mimukit/saasaloy/issues/165)

### Documentation

* **template:** carry the release step merge steps to the changelog ([6733b0f](https://github.com/mimukit/saasaloy/commit/6733b0f38b4f07394df599bbced487655169f513)), references [#236](https://github.com/mimukit/saasaloy/issues/236)

### Code Refactoring

* **billing:** merge entitlements into billing ([c922f0e](https://github.com/mimukit/saasaloy/commit/c922f0e82e581aac888a9f259fe9dfd98c3b910d)), references [#165](https://github.com/mimukit/saasaloy/issues/165)
* **modules:** dissolve rbac into teams and multitenant ([976046c](https://github.com/mimukit/saasaloy/commit/976046c75ba262293cfb8a1e763345f260a0e021)), references [#167](https://github.com/mimukit/saasaloy/issues/167) [#165](https://github.com/mimukit/saasaloy/issues/165)

## [0.6.1](https://github.com/mimukit/saasaloy/compare/v0.6.0...v0.6.1) (2026-10-22)

### ⚠ BREAKING CHANGES

* **admin:** the admin blocks moved from apps/admin/src/components
  to @repo/ui/blocks/admin, and rail.tsx and nav-panel.tsx are gone.

### Features

* **admin:** move the theme control into an account submenu ([4c58b7d](https://github.com/mimukit/saasaloy/commit/4c58b7d0f9fe4a15db57858fcf317e27fe44a5a2)), references [#192](https://github.com/mimukit/saasaloy/issues/192)
* **admin:** rebuild the admin shell on a copied coss ui set ([f7ff0a5](https://github.com/mimukit/saasaloy/commit/f7ff0a57a7ae26efc297cd78518ddb26179ef386)), references [#192](https://github.com/mimukit/saasaloy/issues/192)
* **modules:** move the module admin pages onto the admin set ([e13f490](https://github.com/mimukit/saasaloy/commit/e13f49047a2e8fff6e840ce48efd3afec3a3b29f)), references [#192](https://github.com/mimukit/saasaloy/issues/192)

### Bug Fixes

* **admin:** flip the admin theme toggle between light and dark ([cac560e](https://github.com/mimukit/saasaloy/commit/cac560ee7d67398db9abc73219c56ae068d8b64b)), references [#192](https://github.com/mimukit/saasaloy/issues/192)
* **admin:** honour a menu popup's own min width ([8fade11](https://github.com/mimukit/saasaloy/commit/8fade119e15c01b11940ca89d817dd2c6abc1e4d)), references [#192](https://github.com/mimukit/saasaloy/issues/192)
* **admin:** keep the page header fixed on a short screen ([a9d6bd7](https://github.com/mimukit/saasaloy/commit/a9d6bd7a8d85137c2ffd1a221d2199909ce6a999)), references [#192](https://github.com/mimukit/saasaloy/issues/192)
* **admin:** render the 404 screen inside the existing shell ([f84b929](https://github.com/mimukit/saasaloy/commit/f84b929c9d24bb51c83259744c8f18ff5cb32819)), references [#192](https://github.com/mimukit/saasaloy/issues/192)
* **modules:** name the organization on the roles and keys pages ([94fcbc3](https://github.com/mimukit/saasaloy/commit/94fcbc31b0faf19ea0709b2809ddf4dd3a7977e2)), references [#192](https://github.com/mimukit/saasaloy/issues/192)
* **payment:** use admin components in payments ([7d25f1a](https://github.com/mimukit/saasaloy/commit/7d25f1a25a45c20a2b23d0b2e6a662c5141e3b05))

## [0.6.0](https://github.com/mimukit/saasaloy/compare/v0.5.2...v0.6.0) (2026-10-21)

### ⚠ BREAKING CHANGES

* **env:** env-exec is removed, and the infra service name
  is now deploy in envServices.
* **cli:** no command writes .dev.vars or .dev.vars.example any
  more. An existing project migrates with one `pnpm env:setup`, which
  carries a leftover file's values into .env and deletes it.

  - `saasaloy add` writes packages/env/.env.example, one tracked key list
    with a `# @services` line per reader set, replacing
    apps/api/.dev.vars.example and every per-workspace example
  - a key no installed module describes keeps the comment and the section
    it already had, so the base template's own keys survive regeneration
  - a key the declaring module calls optional gets a `# Blank on purpose`
    line, which is what stops env:setup failing on it
  - `saasaloy env` prompts into the gitignored packages/env/.env and
    nothing else; routeVariable, the workspace inference and the
    `ambiguous` prompt are deleted, about 200 lines
  - `saasaloy env --check` reports a declared key the key list omits,
    which doctor cannot see because it runs offline
  - `saasaloy doctor` fails on a leftover .dev.vars, naming the file and
    the command that migrates it, because wrangler hides .env behind one
    without warning
  - the base _gitignore drops its .dev.vars lines; a leftover one wants to
    be visible until it is deleted
  - every module message and skill that named .dev.vars now names .env and
    the two commands that fill it
* **cli:** saasaloy add infra no longer resolves. A project
  on infra follows docs/wiki/runbooks/move-off-the-infra-module.md.
* **ui:** the web tokens move from globals.css to
  packages/ui/src/styles/web.css, and DESIGN.md moves to
  apps/web/DESIGN.md. saasaloy update creates web.css and sends
  globals.css and Layout.astro to the merge plan. Finish the move
  with the steps in the base AGENTS.md under "A project made
  before the theme split". The admin app imports
  @repo/ui/styles/admin.css, which needs the new ./styles/*
  export in packages/ui/package.json.

### Features

* **api:** run the api's tests in node with vitest ([7b28436](https://github.com/mimukit/saasaloy/commit/7b28436215b0dca2eb0af06de4caaf4919497b10)), references [#207](https://github.com/mimukit/saasaloy/issues/207)
* **cli:** add the [@root](https://github.com/root) alias for a repo-root file ([399e666](https://github.com/mimukit/saasaloy/commit/399e66604384893367bf55753ca61d3821f4abb1)), references [#152](https://github.com/mimukit/saasaloy/issues/152)
* **cli:** format patched files with the project's prettier ([e1898ae](https://github.com/mimukit/saasaloy/commit/e1898aefbb195080a7904147bdfce865fa81dfb8))
* **cli:** generate one key list and retire .dev.vars ([8ad2cd4](https://github.com/mimukit/saasaloy/commit/8ad2cd48fdeb144541fafc5ff34151f936bc9bde))
* **cli:** name the cli floor before the schema errors ([d002c99](https://github.com/mimukit/saasaloy/commit/d002c990855db00fdc4c3503d5525aff1070674b)), references [#205](https://github.com/mimukit/saasaloy/issues/205)
* **cli:** remove the pulumi infra module ([76cdf6d](https://github.com/mimukit/saasaloy/commit/76cdf6d92e511e5089a170744125ced8fcd6f6d4)), references [#198](https://github.com/mimukit/saasaloy/issues/198)
* **database-d1:** add db:seed and a route test harness ([4e29dff](https://github.com/mimukit/saasaloy/commit/4e29dff32271296b15496bca77c587248f313d5e)), references [#207](https://github.com/mimukit/saasaloy/issues/207)
* **database-d1:** add db:setup, db:status and db:drop ([514feb1](https://github.com/mimukit/saasaloy/commit/514feb1c0460a006835e8834383bcd2ac8d2d1e3)), references [#152](https://github.com/mimukit/saasaloy/issues/152)
* **database-postgres:** add db:seed and a route test harness ([0a6d332](https://github.com/mimukit/saasaloy/commit/0a6d332da72dac48b29ea421c3ea4f93e6800636)), references [#207](https://github.com/mimukit/saasaloy/issues/207)
* **database-postgres:** add db:setup, db:status and db:drop ([7e4c941](https://github.com/mimukit/saasaloy/commit/7e4c941dedfd8291f820c3e393a2e6db77d2d895)), references [#152](https://github.com/mimukit/saasaloy/issues/152)
* **database:** add the seed engine and slice convention ([237d243](https://github.com/mimukit/saasaloy/commit/237d2433657ab9b5cee4ecdc7b2eb45cb455b050)), references [#207](https://github.com/mimukit/saasaloy/issues/207)
* **env-infisical:** add the infisical value source ([0de8155](https://github.com/mimukit/saasaloy/commit/0de8155e0811fe9ea1d5e17da81057b473187c3a))
* **env:** add packages/env to the base template ([b26c31d](https://github.com/mimukit/saasaloy/commit/b26c31d54336f2eb174974e2a295a266c31a7fc3))
* **env:** compose capability presets per service ([5566777](https://github.com/mimukit/saasaloy/commit/5566777f786fab738786f30dc3f6afa934f1fe2b))
* **env:** deploy every worker with pnpm deploy:production ([8253ea5](https://github.com/mimukit/saasaloy/commit/8253ea5da7b5130ff4cef25daaada120ab213965)), references [#198](https://github.com/mimukit/saasaloy/issues/198)
* **modules:** deploy modules through env-deploy ([9234e30](https://github.com/mimukit/saasaloy/commit/9234e30a2a4552ac1ad44636ee9798f9e65ebd9a)), references [#198](https://github.com/mimukit/saasaloy/issues/198)
* **modules:** ship seed slices for every module table ([976e6d4](https://github.com/mimukit/saasaloy/commit/976e6d4863b4286fef6033aac6a03c275d983da4)), references [#207](https://github.com/mimukit/saasaloy/issues/207)
* **payment-manual:** add the manual payment provider ([92ca217](https://github.com/mimukit/saasaloy/commit/92ca21759fb60d48bbeecb0c092e71ffeabd6f9c)), references [#213](https://github.com/mimukit/saasaloy/issues/213)
* **payment:** add the admin payments review page ([58bb445](https://github.com/mimukit/saasaloy/commit/58bb445746787e1ea2ca38b702c58a9aa6b3c02d)), references [#212](https://github.com/mimukit/saasaloy/issues/212)
* **payment:** add the payment capability and payment-console ([90dbe4b](https://github.com/mimukit/saasaloy/commit/90dbe4be0d01967a0ea85c770b1c1267fb4203ed)), references [#212](https://github.com/mimukit/saasaloy/issues/212)
* **payment:** ship seed slices for the payment tables ([49d510d](https://github.com/mimukit/saasaloy/commit/49d510d1cc4a2045fd811c52c0011cef030db069)), references [#212](https://github.com/mimukit/saasaloy/issues/212)
* **repo:** add play:snap and play:restore ([4e2c5dc](https://github.com/mimukit/saasaloy/commit/4e2c5dca09979930667287f422b9fd44cf7f35ef)), references [#178](https://github.com/mimukit/saasaloy/issues/178)
* **repo:** allow a reasoned verify-content exception ([8341bf0](https://github.com/mimukit/saasaloy/commit/8341bf048c08168eaf2b7f826e8cc82538168a0d)), references [#191](https://github.com/mimukit/saasaloy/issues/191)
* **repo:** sync module edits into the playground ([dcf8214](https://github.com/mimukit/saasaloy/commit/dcf821415d597b307ee477d8279569a9696b7dd7)), references [#178](https://github.com/mimukit/saasaloy/issues/178)
* **template:** run vitest across every workspace ([e1b5313](https://github.com/mimukit/saasaloy/commit/e1b5313271a8267e19b283948bd3752beba79e98)), references [#207](https://github.com/mimukit/saasaloy/issues/207)
* **ui:** add landing layout, type and motion tokens ([b7adb4b](https://github.com/mimukit/saasaloy/commit/b7adb4b6a292f12150fa4d65c1b5de368f622b68)), references [#191](https://github.com/mimukit/saasaloy/issues/191)
* **ui:** balance the pricing cards ([ebfbcce](https://github.com/mimukit/saasaloy/commit/ebfbccedd793d872e0903e4b4d645912ca9fe333))
* **ui:** drop the version from the hero pill ([72cd201](https://github.com/mimukit/saasaloy/commit/72cd20147a081005d41f55b0a93d67e0bf006f6a)), references [#191](https://github.com/mimukit/saasaloy/issues/191)
* **ui:** make the theme toggle two-state with a reveal ([fa213d4](https://github.com/mimukit/saasaloy/commit/fa213d42669dd9bc671fed7048ed5dc87f7eb6b2)), references [#191](https://github.com/mimukit/saasaloy/issues/191)
* **ui:** open outbound landing links in a new tab ([c6bb096](https://github.com/mimukit/saasaloy/commit/c6bb096c08b1282f14cd86becc1efe144dd2666f))
* **ui:** rebuild the landing page as thirteen blocks ([b571dfd](https://github.com/mimukit/saasaloy/commit/b571dfdf1fed36b92d60825746d377c048931b71)), references [#191](https://github.com/mimukit/saasaloy/issues/191)
* **ui:** reveal the hero light beams on load ([0fbc7db](https://github.com/mimukit/saasaloy/commit/0fbc7db4546056cab14fc4432b2f870367c1df4d))
* **validators:** add a bangladesh mobile schema ([ff8ebfc](https://github.com/mimukit/saasaloy/commit/ff8ebfca7c0850384c21b6b19c3523928dbcf611)), closes [#147](https://github.com/mimukit/saasaloy/issues/147)

### Bug Fixes

* **api-keys:** read the key list from apiKeys ([3d296ae](https://github.com/mimukit/saasaloy/commit/3d296aeb28510bbe57a656f556598ac75c639222))
* **cli:** keep earlier services on a redeclared env key ([be06bf9](https://github.com/mimukit/saasaloy/commit/be06bf9aa79c4e862bb9c3b31bf327251ae0ba0d))
* **cli:** name a generic ai coding tool in skill hints ([c40be88](https://github.com/mimukit/saasaloy/commit/c40be88834d51ede1f2372bbc1844a89ac2c8e99))
* **cli:** run git init in an ignored target ([003320a](https://github.com/mimukit/saasaloy/commit/003320a564e2ac86feb2cde4736c68ce4c32eec7)), references [#178](https://github.com/mimukit/saasaloy/issues/178)
* **database-postgres:** export env-preset and add @repo/env ([7e3c8f9](https://github.com/mimukit/saasaloy/commit/7e3c8f9d7eb65e397fe866b90a2c44a830870920)), closes [#206](https://github.com/mimukit/saasaloy/issues/206)
* **database-postgres:** guard the test database and seed host ([de06ed1](https://github.com/mimukit/saasaloy/commit/de06ed12e706de386f588f921c688a981ad8c280)), references [#207](https://github.com/mimukit/saasaloy/issues/207)
* **database-postgres:** keep the state block in apps/api/.env.db ([d491269](https://github.com/mimukit/saasaloy/commit/d491269587f02320fce0b566e890e3902d178366))
* **database:** keep the primary key out of the upsert set ([4e6f4df](https://github.com/mimukit/saasaloy/commit/4e6f4df64773cbe2a34700110f3a311751cab6e5)), references [#207](https://github.com/mimukit/saasaloy/issues/207)
* **database:** turn off the vitest module cache ([eba5691](https://github.com/mimukit/saasaloy/commit/eba56912c2571e6516a6b5757ccf90408e703dec)), references [#207](https://github.com/mimukit/saasaloy/issues/207)
* **env-infisical:** import the provider with a .ts path ([012f16a](https://github.com/mimukit/saasaloy/commit/012f16a3909042faa95e7c89913136319c766fc4))
* **env:** break the cycle between sources and infisical ([d8f0a3f](https://github.com/mimukit/saasaloy/commit/d8f0a3f29f07fad3398b69a28f27c84f72562bff))
* **modules:** seed only rows the admin pages keep ([ca14f85](https://github.com/mimukit/saasaloy/commit/ca14f851df3a95d66403a6b203a033c038f5dc0c)), references [#207](https://github.com/mimukit/saasaloy/issues/207)
* **multitenant:** move loadStatements out of tenant.ts ([cfacb74](https://github.com/mimukit/saasaloy/commit/cfacb74764442eb03130c2dd06b30ff89d129278))
* **multitenant:** re-export loadStatements from tenant.ts ([a392772](https://github.com/mimukit/saasaloy/commit/a3927729276599c661edab2cccddbd475841b19e))
* **registry:** declare the cli each descriptor needs ([ca43144](https://github.com/mimukit/saasaloy/commit/ca43144f288e8a3db0a5c8cc3f2080ca9b6141a4)), closes [#205](https://github.com/mimukit/saasaloy/issues/205)
* **release:** support planned versions with interactive npm auth ([904ad49](https://github.com/mimukit/saasaloy/commit/904ad49eb253300ab1dee2e05f37f4bbc02a065b))
* **repo:** finish a play:watch sync job only once ([3033c91](https://github.com/mimukit/saasaloy/commit/3033c91f2dfb03f1b790b817bd9c94d5c5cf92f8)), references [#178](https://github.com/mimukit/saasaloy/issues/178)
* **repo:** keep play:restore --db honest when a step fails ([275dfa2](https://github.com/mimukit/saasaloy/commit/275dfa28d1d74f97cfb7a3d3631ba0df46af334e)), references [#178](https://github.com/mimukit/saasaloy/issues/178)
* **repo:** lint shipped files with the template's config ([24a9a24](https://github.com/mimukit/saasaloy/commit/24a9a242e42b3664168e708d24c9c750e8daeca0))
* **repo:** stop restarting the api on play:restore --db ([2b1fb3c](https://github.com/mimukit/saasaloy/commit/2b1fb3cf104f09aa7573e761d7c8b87c3b6a913a))
* **ui:** pass the type-aware lint in two shipped blocks ([cbe7122](https://github.com/mimukit/saasaloy/commit/cbe712276931cbc015b0e4b3b2d1d93d82b00bc3))
* **ui:** run the hero background behind the navbar ([98fb3c4](https://github.com/mimukit/saasaloy/commit/98fb3c448e3ea2636869bc5331d9573076e1792b)), references [#191](https://github.com/mimukit/saasaloy/issues/191)
* **validators:** accept only a space as whitespace ([a56b7cb](https://github.com/mimukit/saasaloy/commit/a56b7cbe0fae0f82cf908ad6b2d7e9d461504f5d))
* **web:** keep astro build off the dev server's vite cache ([2fa06c5](https://github.com/mimukit/saasaloy/commit/2fa06c54d6495f9e5da6e97707b96b6cbe9bd324))
* **web:** scan island deps for the client optimizer ([93aef6a](https://github.com/mimukit/saasaloy/commit/93aef6ada61e78c1a47dbeab40bc49b814b80345))

### Code Refactoring

* **ui:** split the shared stylesheet into per-app themes ([dd9a0ec](https://github.com/mimukit/saasaloy/commit/dd9a0eca11064c2a53170badcc537f8746e36d31)), references [#191](https://github.com/mimukit/saasaloy/issues/191) [#192](https://github.com/mimukit/saasaloy/issues/192) [#193](https://github.com/mimukit/saasaloy/issues/193)

## [0.5.2](https://github.com/mimukit/saasaloy/compare/v0.5.1...v0.5.2) (2026-10-02)

### Features

* **repo:** expose dev servers on all interfaces ([d1659de](https://github.com/mimukit/saasaloy/commit/d1659dece00c6d09b80d1b14b882cc00303987f3))

### Bug Fixes

* **auth:** re-verify schema snapshots against better-auth 1.7.7 ([58906a4](https://github.com/mimukit/saasaloy/commit/58906a49f0a24411f11dfb53f95b279631255e7b))
* **web:** enable nodejs_compat for the web worker ([c22b703](https://github.com/mimukit/saasaloy/commit/c22b703af0c7ad81888aa1aa4955b777eab42203))
* **web:** start astro dev on the base template ([71d891e](https://github.com/mimukit/saasaloy/commit/71d891ed5b5cdcef926797274ef27a891e62974a)), closes [#186](https://github.com/mimukit/saasaloy/issues/186)

## [0.5.1](https://github.com/mimukit/saasaloy/compare/v0.5.0...v0.5.1) (2026-09-29)

### ⚠ BREAKING CHANGES

* **cli:** remove no longer lets a failed state-file save mask
  the error that stopped the run, and all three saves now run on every
  exit rather than stopping at the first throw.

### Features

* **cli:** add the nav-entry patch kind ([4e3b3fd](https://github.com/mimukit/saasaloy/commit/4e3b3fdb2bd513725640b443a2eafcbf61852d25))
* **infra:** deploy assets-only workers ([1c369cf](https://github.com/mimukit/saasaloy/commit/1c369cfae40425754c527bfc17e4ff1ac740d1d2)), references [#180](https://github.com/mimukit/saasaloy/issues/180)

### Bug Fixes

* **infra:** accept trailing commas in wrangler.jsonc ([d1d96a0](https://github.com/mimukit/saasaloy/commit/d1d96a0b4e5abb5e6907e35fff23af58fa697d71)), references [#180](https://github.com/mimukit/saasaloy/issues/180)
* **modules:** move admin nav rows onto nav-entry ([53f0dda](https://github.com/mimukit/saasaloy/commit/53f0ddafca0ef3a14c4116f146c83b6c607f699b))
* **ui:** narrow the theme value with a type guard ([9d7266f](https://github.com/mimukit/saasaloy/commit/9d7266fde4edb7e269f4dcc1ce34db862f284610))

### Code Refactoring

* **cli:** route every state-file write through one ledger ([6073eae](https://github.com/mimukit/saasaloy/commit/6073eae7840005361fa4b4d269516ea7e2e9ded9)), closes [#150](https://github.com/mimukit/saasaloy/issues/150)

## [0.5.0](https://github.com/mimukit/saasaloy/compare/v0.4.0...v0.5.0) (2026-09-12)

### ⚠ BREAKING CHANGES

* **database:** a project that already applied the singular
  migrations must run db:generate, answer "renamed" for each table, and
  read the SQL before applying it. Update auth before teams, api-keys
  and billing, because usePlural and the schema rename work together.

### Bug Fixes

* **database:** name every table in plural snake_case ([c355f93](https://github.com/mimukit/saasaloy/commit/c355f93caa521a7ef129a59198be6d796084ae04))

## [0.4.0](https://github.com/mimukit/saasaloy/compare/v0.3.0...v0.4.0) (2026-09-11)

### Features

* **sms-khudebarta:** add the khudebarta sms provider ([ef609a9](https://github.com/mimukit/saasaloy/commit/ef609a9c7aa9145e7d076737b43873d0bd73d7c9)), references [#146](https://github.com/mimukit/saasaloy/issues/146)

### Bug Fixes

* **sms-khudebarta:** refuse redirects with manual mode ([b2f2dcd](https://github.com/mimukit/saasaloy/commit/b2f2dcd9f7a351567c30381061c7936373194057)), references [#146](https://github.com/mimukit/saasaloy/issues/146)

## [0.3.0](https://github.com/mimukit/saasaloy/compare/v0.2.0...v0.3.0) (2026-09-11)

### Features

* **admin:** add the page primitives a screen builds on ([93c6e5f](https://github.com/mimukit/saasaloy/commit/93c6e5f615fc8fefc39ba09e63966943c87a6016)), references [#123](https://github.com/mimukit/saasaloy/issues/123)
* **admin:** render the overview and users screens ([6f34720](https://github.com/mimukit/saasaloy/commit/6f347205d1b5bfbf03ece93a6e0502e01195bb77)), references [#123](https://github.com/mimukit/saasaloy/issues/123)
* **admin:** scope a dark-first theme and inter to the admin app ([2e04cb9](https://github.com/mimukit/saasaloy/commit/2e04cb9bd645dc902a14e45c772def83e2074acf)), references [#080808](https://github.com/mimukit/saasaloy/issues/080808) [#13161b](https://github.com/mimukit/saasaloy/issues/13161b) [#1c2026](https://github.com/mimukit/saasaloy/issues/1c2026) [#373c43](https://github.com/mimukit/saasaloy/issues/373c43) [#c8c6c5](https://github.com/mimukit/saasaloy/issues/c8c6c5) [#123](https://github.com/mimukit/saasaloy/issues/123)
* **admin:** split the shell into three panels ([60f5eee](https://github.com/mimukit/saasaloy/commit/60f5eee0f1a9bc68c5164879450ed1ce866f30bc)), references [#123](https://github.com/mimukit/saasaloy/issues/123)
* **api-keys:** add organization-owned bearer credentials ([6bf41cd](https://github.com/mimukit/saasaloy/commit/6bf41cdbfe011e8491cb82a6ded30ac0139c057e)), references [#128](https://github.com/mimukit/saasaloy/issues/128) [#129](https://github.com/mimukit/saasaloy/issues/129) [#128](https://github.com/mimukit/saasaloy/issues/128)
* **auth:** add the superadmin role above admin ([afc3fae](https://github.com/mimukit/saasaloy/commit/afc3fae4b0d7126abbb47ec569e784f9a3c86ad7)), references [#128](https://github.com/mimukit/saasaloy/issues/128)
* **billing-console:** add the local billing provider ([9da631e](https://github.com/mimukit/saasaloy/commit/9da631e056b950e2e8de44d8a1628d5cdf22b266))
* **billing-stripe:** add the stripe billing provider ([03d9bcd](https://github.com/mimukit/saasaloy/commit/03d9bcd4b6f05cdf865717759459afda1bc6e39a))
* **billing:** add the routes, the event consumer and the admin page ([5388a36](https://github.com/mimukit/saasaloy/commit/5388a36c3d02a5a8c495977f5954e217c614f7cd)), references [#126](https://github.com/mimukit/saasaloy/issues/126)
* **billing:** add the vendor-blind billing core ([e02c41e](https://github.com/mimukit/saasaloy/commit/e02c41e26cda9daa6b57096e408f657d0faea9fd))
* **billing:** carry what a real provider needs ([220ea5a](https://github.com/mimukit/saasaloy/commit/220ea5aeceb7802c9006a0f1ca2581bc64fb5c92))
* **billing:** send the trial and dunning emails from the queue ([56d3dd9](https://github.com/mimukit/saasaloy/commit/56d3dd9f6d6b6e7b7a340e3ac9ade5124808320e))
* **cli:** add the drizzle-column patch kind ([590ff93](https://github.com/mimukit/saasaloy/commit/590ff932358f508e9bd56555f8cb6f0fad92b93a))
* **cli:** check every rate limit policy has its binding ([9215db7](https://github.com/mimukit/saasaloy/commit/9215db72c83c1dc0abe5aac0fdabb435272436ac))
* **entitlements:** resolve what a plan allows from the project's tables ([e8be36f](https://github.com/mimukit/saasaloy/commit/e8be36f6a502e578e6dbb08cf56ee64b8f627b31))
* **feature-flags:** add typed flags over a published kv document ([b43e3cc](https://github.com/mimukit/saasaloy/commit/b43e3cce0369ae3ed12e79f115a734a1306ff299))
* **kv:** add the kv-cloudflare and kv-memory providers ([4c97a3f](https://github.com/mimukit/saasaloy/commit/4c97a3fe44e7085b5073382da4f6031281df2a23))
* **kv:** add the provider-agnostic kv capability core ([8e919d6](https://github.com/mimukit/saasaloy/commit/8e919d6a5e6ddffdbc92052edb9a6b4fb9061167)), references [#129](https://github.com/mimukit/saasaloy/issues/129)
* **multitenant:** resolve the tenant and guard every scoped query ([1c15040](https://github.com/mimukit/saasaloy/commit/1c150402774e3eefad6836fa9c369f3f79b59d3a)), references [#128](https://github.com/mimukit/saasaloy/issues/128)
* **ratelimit:** add per-route limits over the kv contract ([b02227a](https://github.com/mimukit/saasaloy/commit/b02227a4b62de70578f650206cf711879d5a745b))
* **rbac:** gate a tenant route on runtime-defined roles ([a88d1ca](https://github.com/mimukit/saasaloy/commit/a88d1ca5b2e9a5d35f1aa45ef045ba1e2b78c4a6)), references [#128](https://github.com/mimukit/saasaloy/issues/128)
* **storage:** add the r2 and memory storage providers ([8440d88](https://github.com/mimukit/saasaloy/commit/8440d88a90cb83be608b9dd9a4acd918097717d7))
* **storage:** add the vendor-blind storage core ([9cf7520](https://github.com/mimukit/saasaloy/commit/9cf7520068227ca344d8479e8e3a03702134bf35))
* **teams:** seed the permission vocabulary and dynamic roles ([27559e0](https://github.com/mimukit/saasaloy/commit/27559e08a54f0f6f8fe6f4b4df6de12ddb04f802)), references [#128](https://github.com/mimukit/saasaloy/issues/128)
* **ui:** vendor eight base-ui primitives into the template ([78815c0](https://github.com/mimukit/saasaloy/commit/78815c029f3d6bbe3695e30f7f29ea6b8ff0d3c8)), references [#123](https://github.com/mimukit/saasaloy/issues/123)

### Bug Fixes

* **admin:** let a system theme choice survive a reload ([f4e9cb3](https://github.com/mimukit/saasaloy/commit/f4e9cb34feb01a70bed9d258401844ef3bd0e54a)), references [#123](https://github.com/mimukit/saasaloy/issues/123)
* **api-keys:** carry a key's scope on a field a browser may set ([83d3882](https://github.com/mimukit/saasaloy/commit/83d38828382d7c58277de6cfad920c0f95ebeccd)), references [#128](https://github.com/mimukit/saasaloy/issues/128)
* **api-keys:** drop /api-key/update from the scope guard ([9167507](https://github.com/mimukit/saasaloy/commit/91675076b108bc06862d321870ea9e5f829aff31)), references [#128](https://github.com/mimukit/saasaloy/issues/128)
* **auth:** declare superadmin in the admin plugin's roles ([1fb865c](https://github.com/mimukit/saasaloy/commit/1fb865cacbd4de0c14a9bb43a283c1442ead9e4d)), references [#128](https://github.com/mimukit/saasaloy/issues/128)
* **auth:** pin better-auth 1.7.3 and drop account.issuer ([c4e1234](https://github.com/mimukit/saasaloy/commit/c4e1234e09c1252debdc217338080a6f74d6ca1c))
* **auth:** restore the type on the request-scoped database client ([9a10f7b](https://github.com/mimukit/saasaloy/commit/9a10f7ba72964c95b6dd610c03f479559503a21a))
* **billing:** close the review findings on the billing capability ([d8cdd60](https://github.com/mimukit/saasaloy/commit/d8cdd600cdfe33ae8c3bb54a0360ea6e388e202e)), closes [#133](https://github.com/mimukit/saasaloy/issues/133)
* **billing:** run the background paths and unblock sign-up ([a41cad4](https://github.com/mimukit/saasaloy/commit/a41cad4cc6a7b05c49ebfa4662734d73a311600c))
* **cli:** read an inline definePolicy in the doctor policy check ([af8ae2e](https://github.com/mimukit/saasaloy/commit/af8ae2e07c8afd9d313e16c6c2e2be51b4261687))
* **cli:** use $prepend for the drizzle-column import patch ([f4b45d9](https://github.com/mimukit/saasaloy/commit/f4b45d9066ffd64fb4f0e0b6f81a89ad12715df8))
* **feature-flags:** 404 the override delete for an unknown flag ([9ee7344](https://github.com/mimukit/saasaloy/commit/9ee73448584cbacb52f4d47931c3f194fba15567))
* **feature-flags:** re-sync the flag card slider with the server ([00ece52](https://github.com/mimukit/saasaloy/commit/00ece5266b228106e8faf9e7857db4b6f28ed9be))
* **kv-memory:** drop the raw NUL bytes from the bucket key ([f5005ca](https://github.com/mimukit/saasaloy/commit/f5005cac08a38302026f1b8399f1a7f43be9986f))
* **multitenant:** make the scoped select compile under postgres ([7f29596](https://github.com/mimukit/saasaloy/commit/7f295969d1ebaf3aacc81d4fc72f9dc5d416d22e)), references [#128](https://github.com/mimukit/saasaloy/issues/128)
* **multitenant:** refuse a header naming no organization ([63a3b3e](https://github.com/mimukit/saasaloy/commit/63a3b3eeb6585162b1f9e14417ea6d4e973ed94f)), references [#128](https://github.com/mimukit/saasaloy/issues/128)
* **ratelimit:** build the default limiter key through store.key ([3299d47](https://github.com/mimukit/saasaloy/commit/3299d47a9f5e714da9133d925d37ad136c95f01e))
* **repo:** clear the lint errors the dependency bump introduced ([4859da3](https://github.com/mimukit/saasaloy/commit/4859da3b92ea9d3156014dc95c26bb291bb55a57))
* **teams:** turn on dynamic roles in the client plugin ([1da61e1](https://github.com/mimukit/saasaloy/commit/1da61e19b62250e1bd85cf3b5af2c74e842e7d30)), references [#128](https://github.com/mimukit/saasaloy/issues/128)
* **ui,admin:** correct four review findings from PR [#124](https://github.com/mimukit/saasaloy/issues/124) ([c08fa89](https://github.com/mimukit/saasaloy/commit/c08fa89556f553b84fbc62ca690c7a457e55f2f8))
* **ui:** scan only the primitives a stylesheet's own app renders ([28f23b0](https://github.com/mimukit/saasaloy/commit/28f23b03ee68076e1f0fe5751291dfd4b46662aa)), references [#123](https://github.com/mimukit/saasaloy/issues/123)

## [0.2.0](https://github.com/mimukit/saasaloy/compare/v0.1.1...v0.2.0) (2026-09-09)

### Features

* **api:** split the worker entry from the hono app ([eb80983](https://github.com/mimukit/saasaloy/commit/eb809837b3b2329fe0b8f8af95d719db33f856d6))
* **cli:** accept a dotted bindingType in wrangler-binding ([318cefd](https://github.com/mimukit/saasaloy/commit/318cefd3047f8dee6c20ff40d58a9c69e9784040))
* **cli:** default doctor to the current directory ([7e56c51](https://github.com/mimukit/saasaloy/commit/7e56c51136cff384f7e08ff3946a60105f5e0692))
* **cli:** default doctor to the current directory ([8a51072](https://github.com/mimukit/saasaloy/commit/8a51072e5e2bb3502ac79ca100aa1f59a94911e7))
* **queue-cloudflare:** cloudflare queues provider and cron tick ([4cf4978](https://github.com/mimukit/saasaloy/commit/4cf4978515fe341f5dc7daae7dc39fb16b26c56a)), references [#131](https://github.com/mimukit/saasaloy/issues/131) [#130](https://github.com/mimukit/saasaloy/issues/130)
* **queue-memory:** in-process provider for local dev and tests ([23f81a7](https://github.com/mimukit/saasaloy/commit/23f81a7407e5ad157e2e4716fcfa1680207a5558))
* **queue:** add the neutral queue capability core ([f3ab6d7](https://github.com/mimukit/saasaloy/commit/f3ab6d77c6c75262b6504365b9ef1e74ede58bef)), references [#131](https://github.com/mimukit/saasaloy/issues/131)

### Bug Fixes

* **api:** keep Bindings assignable to a capability env ([533a19f](https://github.com/mimukit/saasaloy/commit/533a19ff2f02e04d98a28ca822ea37fbd673c72c))
* **cli:** restore missing base files at an unmoved template hash ([8331853](https://github.com/mimukit/saasaloy/commit/8331853d16742ea384de61aacea189490bf8e808))
* **cli:** stop update overwriting files the project owns ([cc30e55](https://github.com/mimukit/saasaloy/commit/cc30e55337994de061a7cc7deea83caa11018e16))
* **infra:** refuse unsupported wrangler keys before the build ([8d2312f](https://github.com/mimukit/saasaloy/commit/8d2312fa267fc7402baebf0429f281e87a5a0a20))
* **queue-cloudflare:** report only a real vendor code ([22c25e5](https://github.com/mimukit/saasaloy/commit/22c25e51383b6e88e0e56a4013006d348f868300))
* **queue:** accept a cron step wider than its field ([d7ca562](https://github.com/mimukit/saasaloy/commit/d7ca562049fc917645f67afe45732e82e9359a1f))
* **queue:** wrap a throwing schema as invalid_job ([950a961](https://github.com/mimukit/saasaloy/commit/950a9615a326b0738b767e7536a67791e2bb0838))

## [0.1.1](https://github.com/mimukit/saasaloy/compare/v0.1.0...v0.1.1) (2026-09-06)

### Bug Fixes

* **release:** ship a readme in the published tarball ([bd08378](https://github.com/mimukit/saasaloy/commit/bd08378e1f3a65e722b1edfea699e9715e0a0bd8))

## 0.1.0 (2026-09-06)

### ⚠ BREAKING CHANGES

* **database:** `saasaloy add database` no longer scaffolds a client or a
  wrangler binding. A project needs an explicit driver module for those.

### Features

* **admin:** add a gated GET /admin/users route ([4c09efd](https://github.com/mimukit/saasaloy/commit/4c09efd6b95336562041936c673882a4f31461c2)), references [#97](https://github.com/mimukit/saasaloy/issues/97)
* **admin:** add the admin capability module scaffold ([10a7715](https://github.com/mimukit/saasaloy/commit/10a77152bf3c329ccf258ce163e1f57448cd9f15))
* **admin:** gate the shell behind an admin-role session ([47830b4](https://github.com/mimukit/saasaloy/commit/47830b48a00ced9b601517787601e2cbb4a801bf))
* **admin:** render ErrorState for not-found and render errors ([9fbf258](https://github.com/mimukit/saasaloy/commit/9fbf258f76f7d46d8112a58f171c04c72c199eba)), references [#118](https://github.com/mimukit/saasaloy/issues/118)
* **admin:** render the dashboard from the typed api client ([9860484](https://github.com/mimukit/saasaloy/commit/986048491f5a08a4bf16588402e1870faaa2ee20))
* **admin:** ship the saasaloy-admin skill ([6e506f8](https://github.com/mimukit/saasaloy/commit/6e506f8e2f615328488e5e93ec88051682168b77))
* **agent:** add saasaloy-landing-copy interview skill ([3470e74](https://github.com/mimukit/saasaloy/commit/3470e74aad871df71fb491120989a621100b2f3e))
* **agents:** add canonical agent source for this repo ([9cbd2b5](https://github.com/mimukit/saasaloy/commit/9cbd2b5af7154cdca8cc5f3eb4c1a00b3f9c43d2))
* **agent:** ship the design contract ([507c5ba](https://github.com/mimukit/saasaloy/commit/507c5ba2bc77c3b18d2f4bb8676182af00b3f1c6)), references [#75](https://github.com/mimukit/saasaloy/issues/75)
* **agent:** split the interview into saasaloy-setup ([bb3ab59](https://github.com/mimukit/saasaloy/commit/bb3ab599b3f8ef5ca758873c33f3f6fa52f1f438))
* **api:** add api capability module ([86fe227](https://github.com/mimukit/saasaloy/commit/86fe22754cff23f9c86214f14bad9fc28d25af96)), references [#8](https://github.com/mimukit/saasaloy/issues/8) [#8](https://github.com/mimukit/saasaloy/issues/8)
* **api:** add credentialed CORS with a shared origin allowlist ([2d3ea5b](https://github.com/mimukit/saasaloy/commit/2d3ea5b167451c644616480d6873d793067e78ca))
* **api:** answer an unmatched route with the error envelope ([a1551cb](https://github.com/mimukit/saasaloy/commit/a1551cb21327455f44725c1faf6ab0bbdf2eea8d)), references [#118](https://github.com/mimukit/saasaloy/issues/118)
* **api:** integrate logger capability with request correlation ([7dcafdc](https://github.com/mimukit/saasaloy/commit/7dcafdca05a39e2db1141dc1bc09bb2686d49749))
* **api:** ship the zod validation stack with the capability ([76386b1](https://github.com/mimukit/saasaloy/commit/76386b1b7259266cf2f7d19c4dedca055a23d4bd)), references [#10](https://github.com/mimukit/saasaloy/issues/10)
* **api:** type the route chain and export AppType ([4110c4d](https://github.com/mimukit/saasaloy/commit/4110c4d89b7629a93697e8357b3f40276f5ebe69)), references [#86](https://github.com/mimukit/saasaloy/issues/86)
* **auth:** add auth capability module ([5774e83](https://github.com/mimukit/saasaloy/commit/5774e8343d98502482fe00a9788e98da31f049db))
* **auth:** carry a role on the session with the admin plugin ([589e485](https://github.com/mimukit/saasaloy/commit/589e48536a5fbeb6edc9e1b23be5a4c9ff5f5ecd)), references [#87](https://github.com/mimukit/saasaloy/issues/87)
* **auth:** expose client plugin patch point ([74840d8](https://github.com/mimukit/saasaloy/commit/74840d8f725618ff275bfb9ce1ba365a52007148))
* **auth:** gate api routes on a session role ([0020da4](https://github.com/mimukit/saasaloy/commit/0020da43383f9e6cd8322a2163e569b986863ade)), references [#97](https://github.com/mimukit/saasaloy/issues/97)
* **auth:** install under either database driver ([f787f4a](https://github.com/mimukit/saasaloy/commit/f787f4a61cb4d6d3ce022fe507d73a14dedd2dd5)), references [#99](https://github.com/mimukit/saasaloy/issues/99) [#99](https://github.com/mimukit/saasaloy/issues/99)
* **auth:** mount the handler on api's pre-chain binding ([8d1cfd7](https://github.com/mimukit/saasaloy/commit/8d1cfd7d3e2ec10cac0ad3f9214a5b8a0fbd7125)), references [#86](https://github.com/mimukit/saasaloy/issues/86)
* **auth:** promote the first user to admin ([6b7b6fc](https://github.com/mimukit/saasaloy/commit/6b7b6fcf99bc544a5685eeb2027d9d8a198be957)), references [#97](https://github.com/mimukit/saasaloy/issues/97)
* **base:** add minimal cloudflare base template ([411ec03](https://github.com/mimukit/saasaloy/commit/411ec0388246fccb3bd6664bcd81feacb88c8b47))
* **base:** track template provenance ([3ad6114](https://github.com/mimukit/saasaloy/commit/3ad6114c23fe2d93941cb0687cf6c344a2b60c74))
* **cli:** accept `help` as a command alias ([c5c92da](https://github.com/mimukit/saasaloy/commit/c5c92dacc186d23a0a1780f03a6a9bbd486c73ab))
* **cli:** add --no-install flag to init ([16224bf](https://github.com/mimukit/saasaloy/commit/16224bf6fee15df8647605959a25bf76ce63cebc))
* **cli:** add $schema-validated descriptor schemas ([a427b20](https://github.com/mimukit/saasaloy/commit/a427b20f5c677b98d63f7f4085692ee1af6c5ed6)), references [#5](https://github.com/mimukit/saasaloy/issues/5) [#5](https://github.com/mimukit/saasaloy/issues/5)
* **cli:** add a version flag ([be64d5c](https://github.com/mimukit/saasaloy/commit/be64d5c32d3069353ce5860f686b7474b12a0600))
* **cli:** add agent-view sync pipeline ([17dbd30](https://github.com/mimukit/saasaloy/commit/17dbd309b517a3fb9337eeb74fcd56eea5e4100d))
* **cli:** add config-patch engine (magicast + jsonc-parser) ([485013d](https://github.com/mimukit/saasaloy/commit/485013d5d88fb04383594833aca10288859c9f98)), references [#7](https://github.com/mimukit/saasaloy/issues/7) [#7](https://github.com/mimukit/saasaloy/issues/7)
* **cli:** add local applier engine for add command ([8d32362](https://github.com/mimukit/saasaloy/commit/8d32362ed3dfb5f87e1a7f2d80527258111ad38a)), references [#6](https://github.com/mimukit/saasaloy/issues/6)
* **cli:** add merge plan generation for updates ([c2d12b9](https://github.com/mimukit/saasaloy/commit/c2d12b989f790398d5ae9a7644c4ce6f91f92661))
* **cli:** add package-json-dependency patch kind ([2daa43f](https://github.com/mimukit/saasaloy/commit/2daa43f7b905dc7f1ff518851ab52e7b339d44f9)), references [#10](https://github.com/mimukit/saasaloy/issues/10)
* **cli:** add package-json-script patch kind ([c22c776](https://github.com/mimukit/saasaloy/commit/c22c7766840baa305d7da0c54205930c7d5768b6)), references [#83](https://github.com/mimukit/saasaloy/issues/83)
* **cli:** add reversible module patches ([c9d4d00](https://github.com/mimukit/saasaloy/commit/c9d4d000442b9e71203bdeaf6e7ee66435a6483f)), references [#16](https://github.com/mimukit/saasaloy/issues/16)
* **cli:** add saasaloy cli package skeleton ([c52ac80](https://github.com/mimukit/saasaloy/commit/c52ac806bd1adcbe5887b5a7ae3854a3abbd127c))
* **cli:** add saasaloy doctor ([bc59e7f](https://github.com/mimukit/saasaloy/commit/bc59e7fcfb09864983dcb94fa34341fc6ca3d58d))
* **cli:** add saasaloy remove command ([75853eb](https://github.com/mimukit/saasaloy/commit/75853eb0c90b00e4e12507a4f5713e14e3d078b9)), closes [#27](https://github.com/mimukit/saasaloy/issues/27)
* **cli:** add saasaloy update command ([3fd5199](https://github.com/mimukit/saasaloy/commit/3fd51990ae0a65355984301b3fba5a4a090a9c9f))
* **cli:** add the chained-route patch kind and its inverse ([ddc53a4](https://github.com/mimukit/saasaloy/commit/ddc53a48019eedd55fee8f57b51c38e4edfd62b5)), references [#83](https://github.com/mimukit/saasaloy/issues/83)
* **cli:** add the conflictsWith descriptor field ([a63bc6a](https://github.com/mimukit/saasaloy/commit/a63bc6a988e758ad654f8330700065ebdf212fae)), references [#83](https://github.com/mimukit/saasaloy/issues/83)
* **cli:** add the env command ([88c00fa](https://github.com/mimukit/saasaloy/commit/88c00facbdeb64286cf9a75cb743eb8aab6fb30e)), references [#50](https://github.com/mimukit/saasaloy/issues/50)
* **cli:** add the new module scaffolder ([d9ec4e1](https://github.com/mimukit/saasaloy/commit/d9ec4e1edff4bf8cdf5ee13d6c497cc0a6fc214d)), references [#39](https://github.com/mimukit/saasaloy/issues/39) [#50](https://github.com/mimukit/saasaloy/issues/50)
* **cli:** add the outdated command ([8bfc21b](https://github.com/mimukit/saasaloy/commit/8bfc21b3ef5316099ed97eeaab2f94f8e72021a7)), references [#50](https://github.com/mimukit/saasaloy/issues/50)
* **cli:** add the requiresOneOf descriptor field ([58d846d](https://github.com/mimukit/saasaloy/commit/58d846dc5c9bbce06e8c7b153419a4c0f87ad4e5)), references [#98](https://github.com/mimukit/saasaloy/issues/98)
* **cli:** add update engine for re-applying modules at new versions ([f33b472](https://github.com/mimukit/saasaloy/commit/f33b472a1475066cc6dded7d007793a0d7f727fd))
* **cli:** apply capability scaffolds in add ([a08fd8a](https://github.com/mimukit/saasaloy/commit/a08fd8a98abd94222cee28b9db5acec4b3627419)), references [#8](https://github.com/mimukit/saasaloy/issues/8)
* **cli:** apply module patches as a flat array ([fcdc25b](https://github.com/mimukit/saasaloy/commit/fcdc25ba076262ba923f8f68cc563a0694fd19b6))
* **cli:** fetch modules from a remote github registry ([c036af0](https://github.com/mimukit/saasaloy/commit/c036af0d50ba795ffee1b5e3edd9c01895f9d3a2)), references [#23](https://github.com/mimukit/saasaloy/issues/23) [#23](https://github.com/mimukit/saasaloy/issues/23)
* **cli:** host module skills in .agents with a .claude symlink ([25dcb4a](https://github.com/mimukit/saasaloy/commit/25dcb4a74f8a3d8dd1b63242ac3caae383603e5e)), references [#8](https://github.com/mimukit/saasaloy/issues/8)
* **cli:** implement init base scaffold command ([875bd91](https://github.com/mimukit/saasaloy/commit/875bd91a182e4ad988393a962cd72c042fa7cdbc))
* **cli:** let doctor check a project's installed list ([07a829d](https://github.com/mimukit/saasaloy/commit/07a829d7b6593b3275c4e26fa0142915c68943cd)), references [#107](https://github.com/mimukit/saasaloy/issues/107)
* **cli:** let doctor name a partial install ([874d2c2](https://github.com/mimukit/saasaloy/commit/874d2c2af409c3b2a298621aad1e8585b2d315d2)), references [#49](https://github.com/mimukit/saasaloy/issues/49)
* **cli:** let wrangler-binding upsert bare-string entries ([9d7d14f](https://github.com/mimukit/saasaloy/commit/9d7d14f04d94b6cec9512dd6c3184af7a53e691d))
* **cli:** link base skills in the order they run ([148d7a3](https://github.com/mimukit/saasaloy/commit/148d7a3efe41a64fb0451001102487d00e14ac58))
* **cli:** list modules from the registry ([c38731e](https://github.com/mimukit/saasaloy/commit/c38731edafa3b8905fa5cfb2434ad2c01b311a6e))
* **cli:** offer pnpm install after init scaffold ([5fd0daa](https://github.com/mimukit/saasaloy/commit/5fd0daa53b41e5183d7922f8e4833215f644e217))
* **cli:** pin descriptor deps and add devDependencies bucket ([4e234fc](https://github.com/mimukit/saasaloy/commit/4e234fccdd83e9d708be5dd8896c78e1247394a9))
* **cli:** point at the module skill when a ui block lands ([95131f1](https://github.com/mimukit/saasaloy/commit/95131f15e14efe6cf662669b2ea4774bd7f18f39))
* **cli:** preview a patch reversal under --dry-run and --diff ([134542d](https://github.com/mimukit/saasaloy/commit/134542d4cd4567a9a29f7a44a2600e6e190d9b5a)), references [#36](https://github.com/mimukit/saasaloy/issues/36)
* **cli:** prompt for missing project name in init ([fdaf44a](https://github.com/mimukit/saasaloy/commit/fdaf44aee64b3d577df3561dc8631c574f473d7f))
* **cli:** publish saasaloy to npm ([9815e6d](https://github.com/mimukit/saasaloy/commit/9815e6dc71541e17a8900129283660b6bcbeb5e0))
* **cli:** refactor entrypoint to use command registry and add interactive picker ([c00469a](https://github.com/mimukit/saasaloy/commit/c00469a60a78d4c00f2edcf3b5bc857687c3de93))
* **cli:** refuse a claim on another module's installed file ([e48db6f](https://github.com/mimukit/saasaloy/commit/e48db6f046af4d1703ec03195d026baeeac79f6a)), references [#91](https://github.com/mimukit/saasaloy/issues/91) [#91](https://github.com/mimukit/saasaloy/issues/91)
* **cli:** refuse a descriptor that needs a newer cli ([b18beb2](https://github.com/mimukit/saasaloy/commit/b18beb2e8cd2022ce8c9abf808250ef2d96501f7)), references [#50](https://github.com/mimukit/saasaloy/issues/50)
* **cli:** refuse an unrelated same-run file collision ([5fe3ff6](https://github.com/mimukit/saasaloy/commit/5fe3ff6f5ed522b9941c14a0d03bacb198f10db8)), references [#91](https://github.com/mimukit/saasaloy/issues/91) [#91](https://github.com/mimukit/saasaloy/issues/91)
* **cli:** reverse wrangler-binding and plugin-array patches on remove ([43ef8b5](https://github.com/mimukit/saasaloy/commit/43ef8b5f37af6a644fef4b3994e0516ad0afbeaa)), closes [#36](https://github.com/mimukit/saasaloy/issues/36), references [#83](https://github.com/mimukit/saasaloy/issues/83)
* **cli:** run git init when saasaloy init scaffolds a project ([dcd6a7f](https://github.com/mimukit/saasaloy/commit/dcd6a7fdae0f2cea2d7c47de5bd842c2cc11ca67))
* **cli:** select a module file by an onlyWith condition ([fcf9628](https://github.com/mimukit/saasaloy/commit/fcf96282f339c488aafe6b13a3ffa0e4f537abe8)), references [#98](https://github.com/mimukit/saasaloy/issues/98) [#99](https://github.com/mimukit/saasaloy/issues/99)
* **cli:** sharpen the command surface and retire the web pseudo-module ([ab6987d](https://github.com/mimukit/saasaloy/commit/ab6987d17f0af3404044b049a2216ccb2ecc2218)), references [#98](https://github.com/mimukit/saasaloy/issues/98) [#98](https://github.com/mimukit/saasaloy/issues/98)
* **cli:** style help and stub commands with clack ([02b2ccd](https://github.com/mimukit/saasaloy/commit/02b2ccdfd7572044c60a33151ef89f8020cb43e0))
* **cli:** symlink base skills into .claude/skills on init ([8b2eeec](https://github.com/mimukit/saasaloy/commit/8b2eeec842ad4eb1dca5611f94cae1ae69f569e9))
* **cli:** track applied config patches in the manifest ([8b96f3c](https://github.com/mimukit/saasaloy/commit/8b96f3c5a2b60e35d3185b27f4e5cb938d2535c7)), references [#27](https://github.com/mimukit/saasaloy/issues/27)
* **cli:** track module-relative source paths in manifest ([28b073b](https://github.com/mimukit/saasaloy/commit/28b073b634b9e467136643ba909fcd4412e69362))
* **database-d1:** add the cloudflare d1 driver module ([cc7271d](https://github.com/mimukit/saasaloy/commit/cc7271de2467c3ebfef0a92abc7a070ed799f789)), references [#85](https://github.com/mimukit/saasaloy/issues/85) [#85](https://github.com/mimukit/saasaloy/issues/85)
* **database-d1:** normalize the client contract ([d286662](https://github.com/mimukit/saasaloy/commit/d286662313931a2810502cb72c45596d53923adc)), references [#99](https://github.com/mimukit/saasaloy/issues/99) [#99](https://github.com/mimukit/saasaloy/issues/99) [#99](https://github.com/mimukit/saasaloy/issues/99)
* **database-postgres:** add the postgres driver module ([2eefc05](https://github.com/mimukit/saasaloy/commit/2eefc0594858a66b823aa5ea736390fc5af633c9)), references [#85](https://github.com/mimukit/saasaloy/issues/85)
* **database-postgres:** add the withDb request helper ([2aaf769](https://github.com/mimukit/saasaloy/commit/2aaf76979243810094e74bb31841d61c70e3d376)), references [#98](https://github.com/mimukit/saasaloy/issues/98)
* **database-postgres:** declare the module for driver exclusion ([c92ffca](https://github.com/mimukit/saasaloy/commit/c92ffca031fe669eff0e893cf1bf915be9b6e5cd)), closes [#85](https://github.com/mimukit/saasaloy/issues/85), references [#85](https://github.com/mimukit/saasaloy/issues/85)
* **database:** add database capability module ([815361f](https://github.com/mimukit/saasaloy/commit/815361f6267110213c85ef2c38a8fb2b84bebdb5)), references [#9](https://github.com/mimukit/saasaloy/issues/9)
* **database:** extract a driver-neutral core ([e6e2fbf](https://github.com/mimukit/saasaloy/commit/e6e2fbfac868ca3b67abbae7fea7395461177f86)), references [#85](https://github.com/mimukit/saasaloy/issues/85) [#85](https://github.com/mimukit/saasaloy/issues/85)
* **database:** wire @repo/db into apps/api at add time ([e1c4a94](https://github.com/mimukit/saasaloy/commit/e1c4a9435a44ec1b5c188cc6d9f5268cc863edab)), references [#10](https://github.com/mimukit/saasaloy/issues/10)
* **email-react:** add react-email as an opt-in template module ([40a2264](https://github.com/mimukit/saasaloy/commit/40a2264cc49be19f1cb3fa63e3eef85b1f85570c)), references [#59](https://github.com/mimukit/saasaloy/issues/59)
* **email:** add provider modules (cloudflare, console) ([d00b7b6](https://github.com/mimukit/saasaloy/commit/d00b7b6607448e6c104c905b0b8b9b8f9eb731ad))
* **email:** add the plunk provider module ([b861989](https://github.com/mimukit/saasaloy/commit/b86198965cfff21688f51a4d6313f01730b6a1bf)), references [#65](https://github.com/mimukit/saasaloy/issues/65)
* **email:** email capability module ([2dacbf0](https://github.com/mimukit/saasaloy/commit/2dacbf0495da02e3a0990f5b37fe45cb5b154e8c))
* **infra:** add centralized IaC deployment capability module ([a7408b4](https://github.com/mimukit/saasaloy/commit/a7408b44065bcb750baec031b112d0e0d5d8efda)), references [#29](https://github.com/mimukit/saasaloy/issues/29)
* **logger:** add logger capability with console provider ([e74270d](https://github.com/mimukit/saasaloy/commit/e74270d0558ffeb2b572942fa167e7a3b83753ad))
* **modules:** drop the database-d1 pin ([8923ee7](https://github.com/mimukit/saasaloy/commit/8923ee71cfd5c431585c835f8a645885ca6460a2)), references [#99](https://github.com/mimukit/saasaloy/issues/99) [#91](https://github.com/mimukit/saasaloy/issues/91)
* **modules:** seed hello and hello-widget worked examples ([e8ac222](https://github.com/mimukit/saasaloy/commit/e8ac22262dfab5c4f1188db203d4ef6bfc53c74d)), references [#23](https://github.com/mimukit/saasaloy/issues/23)
* **patch:** detect already-present entries with user edits for merge plans ([08bc79f](https://github.com/mimukit/saasaloy/commit/08bc79f0c6349649812da139fd6be0beaecda58e))
* **qa:** add worktree-safe playground workflow ([a1f60f6](https://github.com/mimukit/saasaloy/commit/a1f60f62440be4c55bd99d6512d308a7f213184a))
* **registry:** expose commit SHAs and history for merge plans ([f4bdb51](https://github.com/mimukit/saasaloy/commit/f4bdb51077d07c7233b04be20c96a8ac98f500d5))
* **repo:** add deps:check/update/verify maintainer workflow ([725b32c](https://github.com/mimukit/saasaloy/commit/725b32c454a4ded75950a3d43a03bbb982565719))
* **repo:** add interactive DX to dep-update workflow ([154e165](https://github.com/mimukit/saasaloy/commit/154e165e9b92fdcff1da1fe798151b1f3ae815de))
* **repo:** make --dry-run print-only and brighten update selection ([c75d6db](https://github.com/mimukit/saasaloy/commit/c75d6dbdaa465b5d6a0c255dfd5270136612a5b5))
* **repo:** merge deps:check into interactive deps:update ([d8018dd](https://github.com/mimukit/saasaloy/commit/d8018dd046040b9b16c7c60053139c94d2eee6ef))
* **scripts:** add verify-content content drift detector ([4088e83](https://github.com/mimukit/saasaloy/commit/4088e83ea949bb6bbd860b558fe8856a4070d45f))
* **scripts:** add verify-preset script for theme preset validation ([9477e02](https://github.com/mimukit/saasaloy/commit/9477e02b23ab7aa01e37b46fd6532418c42e16f5))
* **scripts:** gate the pin in a descriptor patch range ([0b8ab4c](https://github.com/mimukit/saasaloy/commit/0b8ab4c0ab6210543030b65d3bcd398b3a88740c))
* **scripts:** note cross-manifest version divergence in deps:update ([707c9e1](https://github.com/mimukit/saasaloy/commit/707c9e1cf26821b7cc7bdb58911868edac5903e7)), references [#84](https://github.com/mimukit/saasaloy/issues/84)
* **sms-console:** add sms-console provider module ([13ac002](https://github.com/mimukit/saasaloy/commit/13ac002f2cc10db8f6e0e0e857949d8364cf1fd9)), closes [#67](https://github.com/mimukit/saasaloy/issues/67)
* **sms:** add sms capability module ([696ee6f](https://github.com/mimukit/saasaloy/commit/696ee6f6f2448675e7dae16b93736c917f2d698e)), closes [#67](https://github.com/mimukit/saasaloy/issues/67)
* **teams:** add admin organization screen ([f2d80a4](https://github.com/mimukit/saasaloy/commit/f2d80a44be2b5f18dc7258a5a4fbec886c57f8f9)), references [#16](https://github.com/mimukit/saasaloy/issues/16)
* **teams:** add organization integration ([8136d80](https://github.com/mimukit/saasaloy/commit/8136d80b53c16f7319f9feec9de31aa4bc6f8abb)), references [#16](https://github.com/mimukit/saasaloy/issues/16)
* **template:** add a shared ErrorState block to @repo/ui ([b805d76](https://github.com/mimukit/saasaloy/commit/b805d76d7fe95fcd1d0f7da7cc4f5d03bb037452)), references [#118](https://github.com/mimukit/saasaloy/issues/118)
* **template:** add cross-platform clean scripts ([356e364](https://github.com/mimukit/saasaloy/commit/356e36424c8d24252357f8607e48b74bd18167c4))
* **template:** add tailwind 4 foundation and theme ([2219138](https://github.com/mimukit/saasaloy/commit/221913808c5f6aeb26b2dc36770493bdd164b04a)), references [#42](https://github.com/mimukit/saasaloy/issues/42)
* **template:** add the containers ui layer to @repo/ui ([ee1021e](https://github.com/mimukit/saasaloy/commit/ee1021e1bf0770ef4e7f033f020893c7b3cde9b8))
* **template:** add web 404 and 500 pages ([e03b73d](https://github.com/mimukit/saasaloy/commit/e03b73d2033e89b77a49cb9158d2c36efa42e0f9)), references [#118](https://github.com/mimukit/saasaloy/issues/118)
* **template:** vendor shadcn base-nova primitives ([5a68170](https://github.com/mimukit/saasaloy/commit/5a68170d808f1180f7536802f4547dc8dd7ec3c8)), references [#43](https://github.com/mimukit/saasaloy/issues/43) [#42](https://github.com/mimukit/saasaloy/issues/42)
* **tui:** add isInteractive() to detect terminal availability ([b3b4704](https://github.com/mimukit/saasaloy/commit/b3b47049b65d73466fbb3222f6a08253f16c9911))
* **ui:** add interpolate utility for template strings ([fff2b64](https://github.com/mimukit/saasaloy/commit/fff2b64d06c3c5c83e948ebe5cd74a6992c3add2))
* **ui:** add marketing blocks and rewrite landing page ([1ace151](https://github.com/mimukit/saasaloy/commit/1ace1516be8f5c8fb99b90a4bb690d558b2d2621))
* **ui:** add theme switcher for light/dark and shadcn theme presets ([5718b7c](https://github.com/mimukit/saasaloy/commit/5718b7cdaf53eda2a841d77ad26f00f1bd894538))
* **ui:** implement landing content module ([988c30c](https://github.com/mimukit/saasaloy/commit/988c30c61a1ef2df404ba40fae0b7e391c632126))
* **ui:** move feature icons and cta hrefs to content ([c6376b3](https://github.com/mimukit/saasaloy/commit/c6376b3924725616438ea587ed6350b4b632ac57)), references [faq/#cta](https://github.com/mimukit/saasaloy/issues/cta)
* **validators:** add the validators capability module ([5edb560](https://github.com/mimukit/saasaloy/commit/5edb56049891cf4c7fb182dae04d56cf6deb721c)), references [#84](https://github.com/mimukit/saasaloy/issues/84)
* **waitlist:** add the waitlist feature module ([2e50d73](https://github.com/mimukit/saasaloy/commit/2e50d73503802a0ce66fdf209b97d66fe026ffe8)), references [#10](https://github.com/mimukit/saasaloy/issues/10)
* **waitlist:** install under either database driver ([8663448](https://github.com/mimukit/saasaloy/commit/866344865a9da94292a49c1a96194c6bf8a9c80a)), references [#99](https://github.com/mimukit/saasaloy/issues/99) [#99](https://github.com/mimukit/saasaloy/issues/99)
* **waitlist:** register the route on api's typed chain ([b7ba3f1](https://github.com/mimukit/saasaloy/commit/b7ba3f1655cd3eafab366a9b2e559ea05dc60f2d)), references [#86](https://github.com/mimukit/saasaloy/issues/86)
* **web:** add react and a sections glob to the base template ([3fd7c8b](https://github.com/mimukit/saasaloy/commit/3fd7c8b66e3e6cc0be57dc087da39b49dda88f24)), references [#10](https://github.com/mimukit/saasaloy/issues/10)

### Bug Fixes

* **add:** fail fast without TTY when no module specified ([e38e415](https://github.com/mimukit/saasaloy/commit/e38e415b2499c90df31768dee4d1b5ea4c369b0e))
* **admin:** carry the requested route across sign-in ([9f3f0fc](https://github.com/mimukit/saasaloy/commit/9f3f0fced992a2c6be458861a11c559e6fa39f9b)), closes [#100](https://github.com/mimukit/saasaloy/issues/100)
* **admin:** deny non-admins with a throw in the root guard ([0c0ceb4](https://github.com/mimukit/saasaloy/commit/0c0ceb4401d08ce4e07ed7809beddf0057d1eba1)), references [#87](https://github.com/mimukit/saasaloy/issues/87)
* **admin:** report a failed sign-in when the api is unreachable ([6469f5d](https://github.com/mimukit/saasaloy/commit/6469f5dc4b10c8fa4039a2f2b82fcf096de82615)), references [#87](https://github.com/mimukit/saasaloy/issues/87)
* **api:** answer every thrown error with the error envelope ([9144488](https://github.com/mimukit/saasaloy/commit/9144488482dcc93d90c29f45215ee657652b23d8)), references [#86](https://github.com/mimukit/saasaloy/issues/86)
* **api:** chain the cors middleware onto base ([693ece2](https://github.com/mimukit/saasaloy/commit/693ece2dde3814c3d82556040e937963f8a632a1)), references [#86](https://github.com/mimukit/saasaloy/issues/86)
* **api:** disable vite's dev cors middleware ([39f433a](https://github.com/mimukit/saasaloy/commit/39f433a857b1160a72e29e6f88675c67b23da758))
* **api:** export route sub-apps by name, not by default ([4a65b23](https://github.com/mimukit/saasaloy/commit/4a65b2356e36b918e3af341fdc804532892c9041)), references [#86](https://github.com/mimukit/saasaloy/issues/86)
* **auth:** correct the schema snapshot for 1.7.2 ([00223c0](https://github.com/mimukit/saasaloy/commit/00223c0b6f1d693fcf7e55fffd3dc5b235f27497)), references [#97](https://github.com/mimukit/saasaloy/issues/97)
* **auth:** default updatedAt on session and account inserts ([c26fb2a](https://github.com/mimukit/saasaloy/commit/c26fb2a608940662f5f83e94cc8d97e2a78c5e4b))
* **auth:** guard the api-prefix cookie domain against bare tlds ([3e38afe](https://github.com/mimukit/saasaloy/commit/3e38afe91197e9a578da827f97782a544081490c))
* **auth:** keep the protected-route example self-contained ([9a866c6](https://github.com/mimukit/saasaloy/commit/9a866c69ea21d73e4907f7ca31ea51fe0a0e306c)), references [#86](https://github.com/mimukit/saasaloy/issues/86)
* **auth:** throw when the better auth secret is missing ([b5e1672](https://github.com/mimukit/saasaloy/commit/b5e1672fdc3055bfbaacfbe67e6ff2fce97e2791)), references [#98](https://github.com/mimukit/saasaloy/issues/98)
* **blocks:** close mobile menu on Escape and improve export guidance ([201f7f2](https://github.com/mimukit/saasaloy/commit/201f7f243065e274df7b52bb43c99ed11a834a06))
* **cli:** accept every patch kind in the manifest schema ([962db03](https://github.com/mimukit/saasaloy/commit/962db034efac9ca865f7de9d7a37b84b3299b5dd)), references [#98](https://github.com/mimukit/saasaloy/issues/98)
* **cli:** block the prepare hook's pre and post keys ([4a5a15c](https://github.com/mimukit/saasaloy/commit/4a5a15c14eb50ffd15419c53c4c424c41ccc9675)), references [#98](https://github.com/mimukit/saasaloy/issues/98)
* **cli:** bound a module download with a deadline ([e903b5c](https://github.com/mimukit/saasaloy/commit/e903b5c6e59d7d66958a0782ef525c0c51f50097)), references [#98](https://github.com/mimukit/saasaloy/issues/98)
* **cli:** carry conflictsWith and new env vars through update ([813fd0c](https://github.com/mimukit/saasaloy/commit/813fd0c3700d46d1a7c8fd9bd040b9b27719ebf8)), references [#98](https://github.com/mimukit/saasaloy/issues/98) [#98](https://github.com/mimukit/saasaloy/issues/98)
* **cli:** check import ownership before reverting a route ([b29540c](https://github.com/mimukit/saasaloy/commit/b29540c37fe252a29fcb932e2aa8c96006b9aa94)), references [#90](https://github.com/mimukit/saasaloy/issues/90)
* **cli:** check module conflicts across every outdated graph ([21734e3](https://github.com/mimukit/saasaloy/commit/21734e3d78b98fe1df8bf0901e67c2964de71758))
* **cli:** close the add command write-path holes ([cf29a1e](https://github.com/mimukit/saasaloy/commit/cf29a1e8a68bedf78f3cbd81cf67fe8ffab0e091)), references [#98](https://github.com/mimukit/saasaloy/issues/98)
* **cli:** close the partial-apply window when the apply ends ([87a9d25](https://github.com/mimukit/saasaloy/commit/87a9d25e3f0de0748cc3181cd2025e18215a4ee8)), references [#49](https://github.com/mimukit/saasaloy/issues/49)
* **cli:** correct remove plan drift labeling and warnings ([fc11564](https://github.com/mimukit/saasaloy/commit/fc11564828c27312263abc62d15c0176bad48fd0))
* **cli:** derive installed modules from what add applied ([6599a1e](https://github.com/mimukit/saasaloy/commit/6599a1ec2abb814daff9b367a6874fdbee37ee3a)), references [#49](https://github.com/mimukit/saasaloy/issues/49)
* **cli:** don't read a registry override as drift ([7507b74](https://github.com/mimukit/saasaloy/commit/7507b74a822eca36a37ddd4d3d88a80d61eddb35)), references [#50](https://github.com/mimukit/saasaloy/issues/50)
* **cli:** drop the remove advice when the stale owner keeps files ([cd928bf](https://github.com/mimukit/saasaloy/commit/cd928bfb6db35949b2ad24defca2243e545bd9c5)), references [#107](https://github.com/mimukit/saasaloy/issues/107)
* **cli:** drop the type assertions the type-aware pass rejects ([b2bbcbb](https://github.com/mimukit/saasaloy/commit/b2bbcbbcf4127ffcd1ec080d592127011b5a41ab))
* **cli:** drop the unreachable version branch ([32af4ca](https://github.com/mimukit/saasaloy/commit/32af4ca70cf34cdb466b0af25bd42d59bc4d8bbc)), references [#98](https://github.com/mimukit/saasaloy/issues/98)
* **cli:** exit 2 on a bad module coordinate, and name the base app in list ([bbe3a9c](https://github.com/mimukit/saasaloy/commit/bbe3a9c9060a0c837a36934fbc926a7dcb0621cf)), references [#98](https://github.com/mimukit/saasaloy/issues/98)
* **cli:** gate update on stdin and refuse a conflicting update ([be2d6a2](https://github.com/mimukit/saasaloy/commit/be2d6a250c036474e091b389de3ce6d934d29a65)), references [#98](https://github.com/mimukit/saasaloy/issues/98) [#98](https://github.com/mimukit/saasaloy/issues/98)
* **cli:** guard a descriptor's source path against traversal ([d9fc001](https://github.com/mimukit/saasaloy/commit/d9fc0019e6f2c707042d4ec883298dad23cd8a9b)), references [#98](https://github.com/mimukit/saasaloy/issues/98)
* **cli:** guard the .dev.vars.example write like every other write ([b81d94b](https://github.com/mimukit/saasaloy/commit/b81d94bb7461e075682e3cb9c754dff105d7f170)), references [#98](https://github.com/mimukit/saasaloy/issues/98)
* **cli:** harden add command failure and edge paths ([844ff6d](https://github.com/mimukit/saasaloy/commit/844ff6dbc3919daee82cb0e840d84380fc65ed6c)), references [#6](https://github.com/mimukit/saasaloy/issues/6)
* **cli:** harden doctor input handling and drop auth on cleartext API overrides ([e355c85](https://github.com/mimukit/saasaloy/commit/e355c852cd8f7d23307543d95785cdca07ff6702))
* **cli:** harden init install path and typing ([186168c](https://github.com/mimukit/saasaloy/commit/186168c7f04bdb9faf76e4bfb263e0dc606b7b0d))
* **cli:** harden update's argument and output guards ([fa5b470](https://github.com/mimukit/saasaloy/commit/fa5b4700ad6b02156fd01a77de36bbbf63203701))
* **cli:** keep a failed add from losing its bookkeeping ([65a1a12](https://github.com/mimukit/saasaloy/commit/65a1a1294eeab0fcf882bc5518e8b0956c36bdd8)), references [#49](https://github.com/mimukit/saasaloy/issues/49)
* **cli:** keep chained-route edits byte-faithful ([c708d8e](https://github.com/mimukit/saasaloy/commit/c708d8e662865222dbe6e9be3f5dd39ec5cef2a9))
* **cli:** let a driver's copy of a shared target win ([6f3d023](https://github.com/mimukit/saasaloy/commit/6f3d02398c95f7b45495a750ebab8e2eaf5fa1a9)), references [#98](https://github.com/mimukit/saasaloy/issues/98)
* **cli:** make conflicts.ts reviewable and quiet the lock warning ([25f8f23](https://github.com/mimukit/saasaloy/commit/25f8f2393c9847fd1cbc5d7f890e18c1ed59fa70))
* **cli:** make the plugin-array codemod emit prettier-compatible code ([0af848c](https://github.com/mimukit/saasaloy/commit/0af848cdcc73da8000c1924baf13226f0d035880))
* **cli:** notice a ui write from a patch too ([2d4b2f7](https://github.com/mimukit/saasaloy/commit/2d4b2f72333bac216cc86d262daf7d9d5d2e548f))
* **cli:** pluralize the wire-up line for multi-block modules ([f6a0056](https://github.com/mimukit/saasaloy/commit/f6a0056c7895c908bd78eca1168a65d51e746d78))
* **cli:** point a bare doctor run at the project mode ([1db7498](https://github.com/mimukit/saasaloy/commit/1db74985e20291ef8ce5bd05e978846a3ad65e11))
* **cli:** re-check disk before each add write ([eefd29b](https://github.com/mimukit/saasaloy/commit/eefd29bcf552c16af48fdbafcbf6c0300e1e53ed)), references [#98](https://github.com/mimukit/saasaloy/issues/98)
* **cli:** refuse a descriptor that is not valid JSON ([a9a322c](https://github.com/mimukit/saasaloy/commit/a9a322c146dd7c5723882de391d493e63df7d728))
* **cli:** refuse a state file that is not valid JSON ([2809d12](https://github.com/mimukit/saasaloy/commit/2809d125757a774af895f71de54ea0a5bfacc28c)), references [#98](https://github.com/mimukit/saasaloy/issues/98)
* **cli:** refuse add with no terminal, report a broken config ([a8d5c53](https://github.com/mimukit/saasaloy/commit/a8d5c5353cdfc3a45a49e451442277158261042a)), references [#98](https://github.com/mimukit/saasaloy/issues/98)
* **cli:** reject an unknown flag before answering help ([a19c51f](https://github.com/mimukit/saasaloy/commit/a19c51fd63f8047cb771d03ecb33977e390c5ea5)), references [#98](https://github.com/mimukit/saasaloy/issues/98)
* **cli:** reject inherited registry keys as unknown commands ([395ba9b](https://github.com/mimukit/saasaloy/commit/395ba9bc7852734c58832ea0cfcecb6a4c0b9f45)), references [#69](https://github.com/mimukit/saasaloy/issues/69)
* **cli:** repair global cli link for pnpm 11 ([bb9e8fe](https://github.com/mimukit/saasaloy/commit/bb9e8fe19ca09212c7ff06a145579f04b392d9d7))
* **cli:** report unreadable skill roots instead of linking nothing ([3927954](https://github.com/mimukit/saasaloy/commit/3927954c8152915fe6e8f0e0bab5ec96cdeaa7af))
* **cli:** satisfy main's lint rules after the rebase ([95114ab](https://github.com/mimukit/saasaloy/commit/95114ab3addf3c3c1f218be619ee1960c2ff2ef3))
* **cli:** save the lock on the same path as the manifest ([f84b9cc](https://github.com/mimukit/saasaloy/commit/f84b9ccb9c1a0cb7140f93085dca8cda18b22189)), references [#98](https://github.com/mimukit/saasaloy/issues/98)
* **cli:** ship static agent views and correct deploy command ([3c4ccf1](https://github.com/mimukit/saasaloy/commit/3c4ccf13fbe620676028512fd815404a48ab2f8f))
* **cli:** show pnpm install failure details in a box ([a7d3e75](https://github.com/mimukit/saasaloy/commit/a7d3e755db63e6b6aa003a784598fa3fa1063778))
* **cli:** type the caught refusal so typecheck passes ([290f935](https://github.com/mimukit/saasaloy/commit/290f9355cd73e143e975051e9b02c0545c2340aa))
* **cli:** use warn level only for unresolvable module status ([27ef911](https://github.com/mimukit/saasaloy/commit/27ef9111b581faa375b6bfdf01446799ddf415c3))
* **cli:** validate paths and state before deleting ([591d251](https://github.com/mimukit/saasaloy/commit/591d2511e3e0038fdc4d1ba7a39d36f1ab8fc4e4))
* **cli:** validate the manifest and lock on load ([8cc7d47](https://github.com/mimukit/saasaloy/commit/8cc7d473d802fb1ee5bb2301fed119746b2cf19a)), references [#98](https://github.com/mimukit/saasaloy/issues/98) [#98](https://github.com/mimukit/saasaloy/issues/98)
* **cli:** verify patch ownership before wiring or reverting a route ([0e4102f](https://github.com/mimukit/saasaloy/commit/0e4102f2e880b2bf2304468f542ebe9429a28c39)), references [#90](https://github.com/mimukit/saasaloy/issues/90)
* **cli:** warn and skip a target remove cannot parse ([994f2bb](https://github.com/mimukit/saasaloy/commit/994f2bb6af4a983d8b604d55091e17d838cfafe6))
* **cli:** warn when a reclaimed file leaves a stale manifest owner ([822249b](https://github.com/mimukit/saasaloy/commit/822249bbe696af92d9c6f0c0a5e3c119cb19c69a)), references [#91](https://github.com/mimukit/saasaloy/issues/91) [#49](https://github.com/mimukit/saasaloy/issues/49) [#107](https://github.com/mimukit/saasaloy/issues/107)
* **cli:** write add's deps after the apply lands ([acccd78](https://github.com/mimukit/saasaloy/commit/acccd780588c94f907773e21a91fe6e462595404)), references [#49](https://github.com/mimukit/saasaloy/issues/49) [#98](https://github.com/mimukit/saasaloy/issues/98)
* **database-postgres:** close the connection after the query, not before ([99ad9a3](https://github.com/mimukit/saasaloy/commit/99ad9a327239d3704251c2e40164a97d0cb58fab))
* **email-cloudflare:** map E_INTERNAL_SERVER_ERROR as retryable ([2bf1f2a](https://github.com/mimukit/saasaloy/commit/2bf1f2ad5e2ec401bc4198e7470a37edf1e7d02a))
* **email-cloudflare:** ship the send_email binding as remote: false ([ce05840](https://github.com/mimukit/saasaloy/commit/ce05840f33ef90045d00ce4b2117be186d6dfcea)), references [#15](https://github.com/mimukit/saasaloy/issues/15)
* **email-react:** pin the preview server to port 3002 ([91b8f46](https://github.com/mimukit/saasaloy/commit/91b8f46341ab295a92287990f113256791780d91)), references [#59](https://github.com/mimukit/saasaloy/issues/59)
* **email:** close the EmailError contract gap in resolve() ([3877372](https://github.com/mimukit/saasaloy/commit/3877372fef3f5dc1288bbebb20a41e38bc676725))
* **email:** escape unquoted-attribute delimiters in the html tag ([a29568e](https://github.com/mimukit/saasaloy/commit/a29568e0004e0ad42346ff6c0632879c9cb3304e))
* **email:** normalize every failure path into EmailError ([fe8d72c](https://github.com/mimukit/saasaloy/commit/fe8d72c39c19f10548b24ea281947c9fc3544b29)), references [#15](https://github.com/mimukit/saasaloy/issues/15)
* **email:** reject unsafe cta url schemes ([ce2875d](https://github.com/mimukit/saasaloy/commit/ce2875d447c56f49067b5b771da643cb6eacbae8)), references [#15](https://github.com/mimukit/saasaloy/issues/15)
* **email:** require https for the plunk base url ([bd9e541](https://github.com/mimukit/saasaloy/commit/bd9e541934e3c0229f07fb6241d4a5cd4d3cbc5d)), references [#111](https://github.com/mimukit/saasaloy/issues/111)
* **email:** tighten the plunk error mapping ([212da19](https://github.com/mimukit/saasaloy/commit/212da19ccb19e980a056229bd98f166f508bf45e))
* **infra:** denylist infra deploy credentials from worker secrets push ([0219908](https://github.com/mimukit/saasaloy/commit/0219908f42be2b396be0ba7c331cb28488766452))
* **infra:** fail on malformed wrangler.jsonc instead of truncating ([3833834](https://github.com/mimukit/saasaloy/commit/3833834d21dc2b1080efe2ca9fd7b7ef234afc0b))
* **infra:** match tsconfig moduleResolution to how pulumi runs this code ([b2b7502](https://github.com/mimukit/saasaloy/commit/b2b750256e21e11b3c3ff26cc60d91e197a2335a))
* **infra:** satisfy main's lint rules after the rebase ([aecb03f](https://github.com/mimukit/saasaloy/commit/aecb03f36d367be2886aad16ff5ede13707bba09))
* **init:** fail on base state errors ([5980c55](https://github.com/mimukit/saasaloy/commit/5980c558fd5fd3016dd20f94bd3be74acf242c69))
* **logger:** contain event normalization inside the swallowed boundary ([6ac6c53](https://github.com/mimukit/saasaloy/commit/6ac6c5324abfb981fb8b10045657bf8b580d3be5))
* **logger:** guard parseLevel against prototype pollution ([f14fd3d](https://github.com/mimukit/saasaloy/commit/f14fd3d0199521ab4baf9cd08e817df1bcb4f0ef))
* **merge-plan:** stop promising impossible terminal state ([3d02881](https://github.com/mimukit/saasaloy/commit/3d028817f692b058fb6ea46438c9d74d2ad1f5eb))
* **modules:** declare the database driver each module needs ([6b1e374](https://github.com/mimukit/saasaloy/commit/6b1e374e0e0750c62a8c055f134c9c49111227fb)), references [#99](https://github.com/mimukit/saasaloy/issues/99) [#98](https://github.com/mimukit/saasaloy/issues/98)
* **modules:** resolve real oxlint findings in api and auth templates ([afdab59](https://github.com/mimukit/saasaloy/commit/afdab59efd8dc9af9222f2df12039bee891fc8ba))
* **release:** build the cli on prepack, not prepublishOnly ([330d4bb](https://github.com/mimukit/saasaloy/commit/330d4bb131a7e9ddfa98e49f06e4ea534f2fff83))
* **release:** supply a github token to the release scripts ([0f6ca22](https://github.com/mimukit/saasaloy/commit/0f6ca227ee7c3ced6ce5278646874aced2b7f3b7))
* **remove:** fail fast without TTY when no module specified ([3964f44](https://github.com/mimukit/saasaloy/commit/3964f4464d64b04ebde83609ece5a168c1202bc2))
* **repo:** compare alpha in the preset check ([18a4ad6](https://github.com/mimukit/saasaloy/commit/18a4ad651c2b845b8eefe177fd08d53107abf653))
* **repo:** gate coderabbit reviews behind the ai-review label ([aece9db](https://github.com/mimukit/saasaloy/commit/aece9dbbf25845b172c87b38c28ea38fdfb49bea))
* **repo:** hash the module registry into the test task ([c6ef0c9](https://github.com/mimukit/saasaloy/commit/c6ef0c91e1a05aa539ea6d61cabc6dd867b3db1a))
* **repo:** mirror type-aware pass in lint:fix scripts ([c6617fe](https://github.com/mimukit/saasaloy/commit/c6617fe4abfda3d0f290c19c3a9d44f7124724c3)), closes [#71](https://github.com/mimukit/saasaloy/issues/71)
* **repo:** narrow no-control-regex to inline suppressions ([ee44101](https://github.com/mimukit/saasaloy/commit/ee4410181f5e28c4010bcf949df1d2d9d70f69f5)), closes [#71](https://github.com/mimukit/saasaloy/issues/71)
* **repo:** pin dev ports so CORS stays predictable ([c160982](https://github.com/mimukit/saasaloy/commit/c160982ab638358a5e5211c36c0f10dcb756d3fa))
* **scripts:** assert each verify-content rule flags its own fixture ([682c105](https://github.com/mimukit/saasaloy/commit/682c105eeac9ee31c4800b61cb4d9699eda31d2f))
* **scripts:** bump deps without reflowing manifests ([d0c89f2](https://github.com/mimukit/saasaloy/commit/d0c89f213b0b29496854a06c1d3bdd9dc4bb8747)), references [#93](https://github.com/mimukit/saasaloy/issues/93)
* **scripts:** dedupe and stably sort the divergence note ([2fed379](https://github.com/mimukit/saasaloy/commit/2fed3797d36a4bfa52918aa2c8d63894c033976e))
* **scripts:** reject a non-exact pin in verify-pins ([c6a3b4c](https://github.com/mimukit/saasaloy/commit/c6a3b4c8fda6ada216348bbb0d34b1c362325fe9))
* **scripts:** scan dependency patch ranges in deps:update ([0111f4f](https://github.com/mimukit/saasaloy/commit/0111f4f9c9d82a27ba61263f5bfdbf43162f4382))
* **teams:** map taken slug error and drop duplicate index ([b7d58fd](https://github.com/mimukit/saasaloy/commit/b7d58fd8f11ca140d652d35c5a5521d46aa79a09))
* **teams:** pass generated project checks ([a1c0508](https://github.com/mimukit/saasaloy/commit/a1c05085c7b744259bbe2965e3651546a36e8022)), references [#16](https://github.com/mimukit/saasaloy/issues/16)
* **template:** correct the documented shadcn extension command ([5c027fc](https://github.com/mimukit/saasaloy/commit/5c027fcd01a753af6229285fe1df97da9be3533d)), references [#42](https://github.com/mimukit/saasaloy/issues/42)
* **template:** make the generated typecheck gate load-bearing ([d3c51c2](https://github.com/mimukit/saasaloy/commit/d3c51c2b2028efccc889b66b7ae8ca9132ed2b3d))
* **template:** restore color-scheme when porting to tailwind ([ba38e62](https://github.com/mimukit/saasaloy/commit/ba38e62bfddcf0ed77f50e3b2bb5e39d4daece26)), references [#42](https://github.com/mimukit/saasaloy/issues/42)
* **ui-template:** guard the boot relabel against a tampered data-theme ([ae91624](https://github.com/mimukit/saasaloy/commit/ae91624d64c2a30feb74301343b0163f3288225b))
* **ui:** guard the feature icon lookup against prototype-chain keys ([bf5dbcd](https://github.com/mimukit/saasaloy/commit/bf5dbcda42788fe27e2f5b88fd1f165fc92d9a61))
* **ui:** prevent prototype-chain leaks in interpolate ([e66dca7](https://github.com/mimukit/saasaloy/commit/e66dca70b917beab6de29ce3052bc75b65bb60d0))
* **ui:** read theme toggle state from painted attribute, not storage ([7a8ff76](https://github.com/mimukit/saasaloy/commit/7a8ff76192c3df62b5d3faaabdd8f95f44fbea6c))
* **ui:** satisfy template lint rules ([1308888](https://github.com/mimukit/saasaloy/commit/13088882e73122fb024a8ca1bfce21b0504f4a99))
* **update-deps:** prevent downgrade via unorderable exact prerelease pins ([5a98507](https://github.com/mimukit/saasaloy/commit/5a98507e86ad463be9151a09201cb8311a6fc080)), references [pre-#54](https://github.com/pre-/issues/54)
* **update:** record ref rewrites when SHA doesn't move ([952158e](https://github.com/mimukit/saasaloy/commit/952158e9da983106e57152646d0363bbfd36c635))
* **verify-preset:** assert the preset's own --primary reached the build ([0c52383](https://github.com/mimukit/saasaloy/commit/0c523834446c6a36ddef058f3783935a6cce9fb5))
* **waitlist:** drop route-level cors so api's allowlist applies ([768b919](https://github.com/mimukit/saasaloy/commit/768b9194178bbce59dfc919434ac273ac795abec))
* **web:** add explicit favicon ([4f4e759](https://github.com/mimukit/saasaloy/commit/4f4e759fd3e03ea10f884cf55bc3d990117362be))
* **web:** stop the adapter emitting a SESSION kv binding ([2d4df5e](https://github.com/mimukit/saasaloy/commit/2d4df5e325c4d1cc971af0521cafee3a26cb8be6))

### Performance Improvements

* **repo:** resolve invisible-manifest deps in parallel ([b289dbd](https://github.com/mimukit/saasaloy/commit/b289dbd2ccea9ac6214e84b474538c21076f30ef))
