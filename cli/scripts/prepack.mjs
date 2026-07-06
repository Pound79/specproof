// Bundles the monorepo's templates/ and plugin skills into the cli package so
// `npm pack` includes them (npm only packs files inside the package dir).
// postpack removes the copies again. Logic lives in prepack-lib.mjs so tests
// can import it without triggering the copy.
import { bundle } from "./prepack-lib.mjs";

bundle([
  ["../templates", "templates"],
  ["../plugins/specproof/skills", "skills"],
]);
