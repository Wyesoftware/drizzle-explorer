#!/usr/bin/env bash
# macOS code signing + notarization for the release workflow (also usable locally).
#
#   scripts/macos-sign.sh setup              import the Developer ID certificate into a temporary keychain
#                                            and sign webview-bun's dylib so the embedded copy is signed too
#   scripts/macos-sign.sh sign <App.app>     sign with the hardened runtime, notarize, staple
#   scripts/macos-sign.sh cleanup            delete the temporary keychain
#
# Env: MACOS_CERTIFICATE (base64 .p12), MACOS_CERTIFICATE_PASSWORD, APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD.
#
# Local use (`bun run build` passes --sign): without MACOS_CERTIFICATE the identity comes from
# CODESIGN_IDENTITY, else the login keychain — "Developer ID Application" if present, else
# "Apple Development" (valid on this Mac only), else ad-hoc. Notarization runs only for Developer ID
# signatures when APPLE_ID / APPLE_TEAM_ID / APPLE_APP_PASSWORD are set.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTITLEMENTS="$ROOT/scripts/macos/entitlements.plist"
TMP="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
KEYCHAIN="$TMP/drizzle-explorer-signing.keychain-db"
KEYCHAIN_PASSWORD_FILE="$TMP/drizzle-explorer-signing.pass"
DYLIB="$ROOT/node_modules/webview-bun/build/libwebview.dylib"

identity() {
  security find-identity -v -p codesigning "$KEYCHAIN" | grep "Developer ID Application" | head -1 | sed -E 's/.*"(.+)".*/\1/'
}

# Best identity available in the user's keychains (local builds).
local_identity() {
  if [[ -n "${CODESIGN_IDENTITY:-}" ]]; then
    echo "$CODESIGN_IDENTITY"
    return
  fi
  local list
  list="$(security find-identity -v -p codesigning 2>/dev/null || true)"
  local id
  id="$(echo "$list" | grep "Developer ID Application" | head -1 | sed -E 's/.*"(.+)".*/\1/')"
  [[ -n "$id" ]] || id="$(echo "$list" | grep "Apple Development" | head -1 | sed -E 's/.*"(.+)".*/\1/')"
  echo "$id"
}

case "${1:-}" in
  setup)
    if [[ -z "${MACOS_CERTIFICATE:-}" ]]; then
      echo "::warning::MACOS_CERTIFICATE is not set — the app will be ad-hoc signed only"
      exit 0
    fi
    PASS="$(uuidgen)"
    echo -n "$PASS" > "$KEYCHAIN_PASSWORD_FILE"
    echo "$MACOS_CERTIFICATE" | base64 --decode > "$TMP/certificate.p12"
    security create-keychain -p "$PASS" "$KEYCHAIN"
    security set-keychain-settings -lut 21600 "$KEYCHAIN"
    security unlock-keychain -p "$PASS" "$KEYCHAIN"
    security import "$TMP/certificate.p12" -P "${MACOS_CERTIFICATE_PASSWORD:-}" -A -t cert -f pkcs12 -k "$KEYCHAIN"
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PASS" "$KEYCHAIN" > /dev/null
    security list-keychains -d user -s "$KEYCHAIN" login.keychain-db
    rm -f "$TMP/certificate.p12"
    ID="$(identity)"
    [[ -n "$ID" ]] || { echo "No 'Developer ID Application' identity found in the certificate"; exit 1; }
    echo "Signing identity: $ID"
    # The dylib gets embedded into the executable by `bun build --compile`; sign it first so the copy
    # extracted at runtime carries a valid Developer ID signature.
    codesign --force --timestamp --options runtime --sign "$ID" "$DYLIB"
    ;;

  sign)
    APP="${2:?usage: macos-sign.sh sign <App.app>}"
    BIN="$APP/Contents/MacOS/drizzle-explorer"
    CI_KEYCHAIN=0
    if [[ -n "${MACOS_CERTIFICATE:-}" && -f "$KEYCHAIN" ]]; then
      CI_KEYCHAIN=1
      ID="$(identity)"
    else
      ID="$(local_identity)"
    fi
    if [[ -z "$ID" ]]; then
      echo "Ad-hoc signing $APP (no signing identity available)"
      codesign --force --sign - --entitlements "$ENTITLEMENTS" "$BIN"
      codesign --force --sign - --entitlements "$ENTITLEMENTS" "$APP"
      exit 0
    fi
    echo "Signing $APP with '$ID'"
    codesign --force --timestamp --options runtime --entitlements "$ENTITLEMENTS" --sign "$ID" "$BIN"
    codesign --force --timestamp --options runtime --entitlements "$ENTITLEMENTS" --sign "$ID" "$APP"
    codesign --verify --deep --strict --verbose=2 "$APP"

    if [[ "$ID" != Developer\ ID* ]]; then
      echo "Not notarized: '$ID' is trusted on this Mac only. Distribution needs a 'Developer ID Application' certificate."
      exit 0
    fi
    if [[ -z "${APPLE_ID:-}" || -z "${APPLE_TEAM_ID:-}" || -z "${APPLE_APP_PASSWORD:-}" ]]; then
      if [[ "$CI_KEYCHAIN" == 1 ]]; then echo "::warning::APPLE_ID / APPLE_TEAM_ID / APPLE_APP_PASSWORD not set — skipping notarization"
      else echo "Not notarized: set APPLE_ID / APPLE_TEAM_ID / APPLE_APP_PASSWORD to notarize"; fi
      exit 0
    fi
    ZIP="$TMP/notarize.zip"
    rm -f "$ZIP"
    ditto -c -k --keepParent "$APP" "$ZIP"
    echo "Submitting to Apple notary service…"
    xcrun notarytool submit "$ZIP" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD" --wait
    xcrun stapler staple "$APP"
    spctl --assess --type execute --verbose=2 "$APP"
    rm -f "$ZIP"
    ;;

  cleanup)
    if [[ -f "$KEYCHAIN" ]]; then
      security delete-keychain "$KEYCHAIN" || true
    fi
    rm -f "$KEYCHAIN_PASSWORD_FILE"
    ;;

  *)
    echo "usage: $0 setup | sign <App.app> | cleanup"
    exit 2
    ;;
esac
