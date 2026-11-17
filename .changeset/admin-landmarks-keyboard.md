---
'@forge-cms/admin': patch
---

Admin accessibility (spec 104): the shell now has a "Skip to main content" link, a labelled `Admin` navigation landmark, a breadcrumb `nav` list with `aria-current="page"`, and a `main` landmark around the routed page (also on the sign-in and sign-up pages). The `main` role is dropped when the host app already wraps the admin in a `main` landmark. When a navigation would leave focus on `<body>`, focus moves to the main region. "Log in" and "Exit" are single links (previously a link wrapping a button: two Tab stops), and each sidebar entry is a single Tab stop. No API or configuration change.
