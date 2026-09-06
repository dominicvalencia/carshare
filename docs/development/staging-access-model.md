# Staging access model

The primary owner controls organization ownership, billing, secrets, and alert routing. Engineering
access is named, MFA-protected, least-privilege, environment-specific, reviewed monthly during the
pilot, and removed when no longer required. Shared administrator credentials are prohibited.

Staging must not connect to production data stores, provider live modes, or production signing
material. Pilot users receive application access only. Admin access is limited to authorized
operators supporting Lucena City and Metro Manila during 08:00–18:00 Asia/Manila. Emergency access
is time-bounded and reviewed afterward.

Future role separation is: infrastructure owner (cloud/billing), deployer (release only), Admin
operator (marketplace review), support operator (case handling), financial operator (sandbox then
approved settlement operations), and security/audit operator (read-only audit and incident review).
The primary owner may initially hold necessary roles, but permissions remain individually scoped;
no backup operator is assumed or created.
