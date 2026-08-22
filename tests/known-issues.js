// Pre-existing content gaps this test suite found but does not fix on its own,
// since fixing them means inventing site content (new pages, new images) rather
// than a test or code change. Kept in one place so the reason is visible next to
// the allowlist, and so removing an entry here is a deliberate, reviewable diff.

// Nav links to pages that don't exist yet in this repo (only index.html is built).
const KNOWN_MISSING_PAGES = [
  'about.html',
  'contact.html',
  'team.html',
  'header.html',
  'header-dark.html',
  'header-transparent.html',
];

// Local asset paths referenced by index.html under images/, but the repo only
// ships photos/ — these were never localized from the template's demo content.
const KNOWN_MISSING_ASSETS = [
  'images/favicon.png',
  'images/parallax/12.jpg',
  'images/team/8.jpg',
];

module.exports = { KNOWN_MISSING_PAGES, KNOWN_MISSING_ASSETS };
