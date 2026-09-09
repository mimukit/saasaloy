#!/usr/bin/env bash
# The api half of docs/qa/qa-tenant-scoping-rbac-api-keys-2026-09-09.md, as one runnable
# script. It drives the whole cookie and bearer walkthrough against a live api Worker on
# $API (default http://localhost:4000) and prints one PASS or FAIL line per acceptance
# criterion of issue #128.
#
# Driver-agnostic on purpose: run it once with database-d1 installed and once with
# database-postgres. `scripts/qa-tenant-scoping-serve.sh` brings the playground up on a
# clean database for either one. It needs a clean database, because it creates two
# organizations by slug and a second run on a dirty one collides on `org-a`.
set -u
API=${API:-http://localhost:4000}
O=(-H "Origin: $API" -H "content-type: application/json")
J=/tmp/qa128
mkdir -p $J
pass=0; fail=0
ok() { printf 'PASS  %s\n' "$1"; pass=$((pass + 1)); }
no() { printf 'FAIL  %s -- %s\n' "$1" "$2"; fail=$((fail + 1)); }
check() { # name expected actual
  if [ "$2" = "$3" ]; then ok "$1"; else no "$1" "expected [$2] got [$3]"; fi
}

signup() { # sign up, or sign in when a re-run finds the account already there
  r=$(curl -s -c "$J/$1.txt" -X POST "$API/auth/sign-up/email" "${O[@]}" \
    -d "{\"email\":\"$1@x.test\",\"password\":\"Password123!\",\"name\":\"$1\"}")
  if [ "$(echo "$r" | jq -r '.user.id // "null"')" = null ]; then
    r=$(curl -s -c "$J/$1.txt" -X POST "$API/auth/sign-in/email" "${O[@]}" \
      -d "{\"email\":\"$1@x.test\",\"password\":\"Password123!\"}")
  fi
  echo "$r"
}
as() { u=$1; shift; curl -s -b "$J/$u.txt" -c "$J/$u.txt" "${O[@]}" "$@"; }
code() { u=$1; shift; curl -s -o /dev/null -w '%{http_code}' -b "$J/$u.txt" "${O[@]}" "$@"; }

echo "== 0. accounts (first user wins superadmin)"
r1=$(signup u1); r2=$(signup u2); r3=$(signup u3)
check "u1 is superadmin" superadmin "$(echo "$r1" | jq -r .user.role)"
check "u2 is a plain user" user "$(echo "$r2" | jq -r .user.role)"
U3=$(echo "$r3" | jq -r .user.id)

echo
echo "== P2-2. no organization yet -> 403 'no active organization'"
b=$(as u2 "$API/tenant"); c=$(code u2 "$API/tenant")
check "GET /tenant with no org is 403" 403 "$c"
check "message is the fixed constant" "no active organization" "$(echo "$b" | jq -r .error.message)"
c=$(code u2 "$API/projects")
check "GET /projects with no org is 403" 403 "$c"

echo
echo "== 1. organizations A (u1) and B (u2)"
A_ID=$(as u1 -X POST "$API/auth/organization/create" -d '{"name":"Org A","slug":"org-a"}' | jq -r .id)
B_ID=$(as u2 -X POST "$API/auth/organization/create" -d '{"name":"Org B","slug":"org-b"}' | jq -r .id)
[ -n "$A_ID" ] && [ "$A_ID" != null ] && ok "org A created" || no "org A created" "$A_ID"
[ -n "$B_ID" ] && [ "$B_ID" != null ] && ok "org B created" || no "org B created" "$B_ID"
as u1 -X POST "$API/auth/organization/set-active" -d "{\"organizationId\":\"$A_ID\"}" >/dev/null
as u2 -X POST "$API/auth/organization/set-active" -d "{\"organizationId\":\"$B_ID\"}" >/dev/null

echo
echo "== 2. u3 joins A as a plain member"
INV=$(as u1 -X POST "$API/auth/organization/invite-member" \
  -d "{\"email\":\"u3@x.test\",\"role\":\"member\",\"organizationId\":\"$A_ID\"}" | jq -r .id)
as u3 -X POST "$API/auth/organization/accept-invitation" -d "{\"invitationId\":\"$INV\"}" >/dev/null
as u3 -X POST "$API/auth/organization/set-active" -d "{\"organizationId\":\"$A_ID\"}" >/dev/null
t3=$(as u3 "$API/tenant")
check "u3 resolves to org A" "$A_ID" "$(echo "$t3" | jq -r .organizationId)"
check "u3's principal is a member" member "$(echo "$t3" | jq -r .principal.kind)"

echo
echo "== P2-1/P2-5. GET /tenant on the cookie path"
t1=$(as u1 "$API/tenant")
check "u1 resolves to org A" "$A_ID" "$(echo "$t1" | jq -r .organizationId)"
check "body carries a principal" true "$(echo "$t1" | jq 'has("principal")')"

echo
echo "== P2-3. x-organization-id is superadmin-only"
tb=$(as u1 -H "x-organization-id: $B_ID" "$API/tenant")
check "superadmin crosses into B" "$B_ID" "$(echo "$tb" | jq -r .organizationId)"
c=$(code u3 -H "x-organization-id: $B_ID" "$API/tenant")
check "a member sending the header is 403" 403 "$c"
check "and the message is forbidden" forbidden \
  "$(as u3 -H "x-organization-id: $B_ID" "$API/tenant" | jq -r .error.message)"

echo
echo "== P2-8. tenant isolation on /projects"
as u1 -X POST "$API/projects" -d '{"name":"a-one"}' >/dev/null
as u1 -X POST "$API/projects" -d '{"name":"a-two"}' >/dev/null
as u2 -X POST "$API/projects" -d '{"name":"b-one"}' >/dev/null
check "org A sees only its two rows" "a-one a-two" \
  "$(as u1 "$API/projects" | jq -r '[.projects[].name] | sort | join(" ")')"
check "org B sees only its one row" "b-one" \
  "$(as u2 "$API/projects" | jq -r '[.projects[].name] | sort | join(" ")')"
check "the member of A sees A's rows" "a-one a-two" \
  "$(as u3 "$API/projects" | jq -r '[.projects[].name] | sort | join(" ")')"

echo
echo "== P3-2. requireCan gates the writes"
PID=$(as u1 "$API/projects" | jq -r '.projects[0].id')
c=$(code u3 -X DELETE "$API/projects/$PID")
check "a member may not delete" 403 "$c"
check "and the message names the permission" "permission required: project:delete" \
  "$(as u3 -X DELETE "$API/projects/$PID" | jq -r .error.message)"
c=$(code u3 -X POST "$API/projects" -d '{"name":"nope"}')
check "a member may not create" 403 "$c"
c=$(code u1 -X DELETE "$API/projects/$PID")
check "the owner may delete" 200 "$c"
as u1 -X POST "$API/projects" -d '{"name":"a-one"}' >/dev/null

echo
echo "== P3-3. roleLockGuard refuses the base role names"
for role in owner admin member; do
  c=$(code u1 -X POST "$API/auth/organization/create-role" \
    -d "{\"role\":\"$role\",\"permission\":{\"project\":[\"read\"]},\"organizationId\":\"$A_ID\"}")
  check "create-role $role is refused" 403 "$c"
done
c=$(code u1 -X POST "$API/auth/organization/delete-role" \
  -d "{\"roleName\":\"admin\",\"organizationId\":\"$A_ID\"}")
check "delete-role admin is refused" 403 "$c"
c=$(code u1 -X POST "$API/auth/organization/update-role" \
  -d "{\"roleName\":\"member\",\"data\":{\"permission\":{\"project\":[\"delete\"]}},\"organizationId\":\"$A_ID\"}")
check "update-role member is refused" 403 "$c"
c=$(code u1 -X POST "$API/auth/organization/create-role" \
  -d "{\"role\":\"auditor\",\"permission\":{\"project\":[\"read\"]},\"organizationId\":\"$A_ID\"}")
check "a custom role name is allowed" 200 "$c"

echo
echo "== P4-1..P4-6. api keys"
K=$(as u1 -X POST "$API/auth/api-key/create" \
  -d "{\"name\":\"qa\",\"organizationId\":\"$A_ID\",\"metadata\":{\"scope\":{\"project\":[\"read\"]}}}")
KEY=$(echo "$K" | jq -r .key); KID=$(echo "$K" | jq -r .id)
[ "$KEY" != null ] && [ -n "$KEY" ] && ok "the plaintext comes back once" || no "plaintext" "$K"
check "a re-read never returns the plaintext" null \
  "$(as u1 "$API/auth/api-key/list?organizationId=$A_ID" | jq -r ".apiKeys[] | select(.id==\"$KID\") | .key // \"null\"")"

bearer() { curl -s -H "Authorization: Bearer $KEY" "${O[@]}" "$@"; }
bcode() { curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "${O[@]}" "$@"; }
tk=$(bearer "$API/tenant")
check "P4-4 bearer resolves org A" "$A_ID" "$(echo "$tk" | jq -r .organizationId)"
check "P4-4 principal kind is apiKey" apiKey "$(echo "$tk" | jq -r .principal.kind)"
check "P4-4 principal carries the key id" "$KID" "$(echo "$tk" | jq -r .principal.keyId)"
c=$(bcode -H "x-organization-id: $B_ID" "$API/tenant")
check "P4-4 x-organization-id beside a bearer is 403" 403 "$c"
check "P4-6 a read-scoped key may list" 200 "$(bcode "$API/projects")"
PID=$(bearer "$API/projects" | jq -r '.projects[0].id')
check "P4-6 a read-scoped key may not delete" 403 "$(bcode -X DELETE "$API/projects/$PID")"
check "P4-6 the refusal names the permission" "permission required: project:delete" \
  "$(bearer -X DELETE "$API/projects/$PID" | jq -r .error.message)"

echo
echo "== P5-1. two requests, one isolate, two tenants on the bearer path"
K2=$(as u2 -X POST "$API/auth/api-key/create" -d "{\"name\":\"qa-b\",\"organizationId\":\"$B_ID\",\"metadata\":{\"scope\":{\"project\":[\"read\"]}}}")
KEY2=$(echo "$K2" | jq -r .key)
o1=$(curl -s -H "Authorization: Bearer $KEY" "${O[@]}" "$API/tenant" | jq -r .organizationId)
o2=$(curl -s -H "Authorization: Bearer $KEY2" "${O[@]}" "$API/tenant" | jq -r .organizationId)
o3=$(curl -s -H "Authorization: Bearer $KEY" "${O[@]}" "$API/tenant" | jq -r .organizationId)
check "request 1 resolves A" "$A_ID" "$o1"
check "request 2 resolves B" "$B_ID" "$o2"
check "request 3 resolves A again" "$A_ID" "$o3"
check "A's key sees only A's rows" "a-one a-two" \
  "$(curl -s -H "Authorization: Bearer $KEY" "${O[@]}" "$API/projects" | jq -r '[.projects[].name]|sort|join(" ")')"
check "B's key sees only B's rows" "b-one" \
  "$(curl -s -H "Authorization: Bearer $KEY2" "${O[@]}" "$API/projects" | jq -r '[.projects[].name]|sort|join(" ")')"

echo
echo "== P4-3. apiKeyScopeGuard refuses an over-scope"
c=$(code u3 -X POST "$API/auth/api-key/create" -d "{\"name\":\"over\",\"organizationId\":\"$A_ID\",\"metadata\":{\"scope\":{\"project\":[\"delete\"]}}}")
check "a member may not mint a delete-scoped key" 403 "$c"

echo
echo "== P4-2/P4-5. expiry, last-used and revocation"
row=$(as u1 "$API/auth/api-key/list?organizationId=$A_ID" | jq -c ".apiKeys[] | select(.id==\"$KID\")")
check "the scope round-trips" '{"project":["read"]}' "$(echo "$row" | jq -c .permissions)"
check "expiresAt is null when omitted" null "$(echo "$row" | jq -r .expiresAt)"
[ "$(echo "$row" | jq -r .lastRequest)" != null ] && ok "lastRequest advanced" || no "lastRequest" "still null"
as u1 -X POST "$API/auth/api-key/delete" -d "{\"keyId\":\"$KID\"}" >/dev/null
check "P4-5 a revoked key is 401" 401 "$(bcode "$API/tenant")"
check "P4-5 the message is invalid api key" "invalid api key" \
  "$(bearer "$API/tenant" | jq -r .error.message)"

echo
printf '\n%s: %d passed, %d failed\n' "${DRIVER:-driver}" "$pass" "$fail"
[ "$fail" -eq 0 ]
