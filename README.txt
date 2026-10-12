FROST CUSTOMER PORTAL — GITHUB FILES
Prepared 12 October 2026

Upload the contents of this folder to the GitHub repository folder that contains
the customer portal's existing index.html. Keep the existing GitHub Pages branch,
publishing folder and custom-domain settings.

index.html is the complete customer portal. Its scripts, styles, logos,
background and spreadsheet reader are embedded, so separate JavaScript, CSS
and image files are not needed. SHEETJS-LICENSE.txt supplies the spreadsheet
library's licence. .nojekyll is a hidden GitHub Pages static-site marker.

This page connects to TMS Reborn using the existing migrated customer logins.
Internet access is needed for sign-in, bookings and Google Maps. The yellow
replica notice has been removed.

The login, quote and booking flow has been tested by the user. The additional
features prepared earlier still require Reborn database service activation
(update 076). A read-only check on 12 October found that the new feature service
is not yet available. Uploading these website files does not activate that
service. Database SQL, desktop installers, test data and build sources are kept
in the development project and should not be uploaded with the website files.

Development project:
/Users/robinson/Desktop/PersonalProjects/FrostCustomerPortal0810

The existing public portal has not been changed by preparing this folder.
