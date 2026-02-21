import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.js";

const CREDENTIALS_DIR = "/etc/claudemar";
const CREDENTIALS_PATH = `${CREDENTIALS_DIR}/.email-credentials`;
const LEGACY_CREDENTIALS_FILE = ".email-credentials";

export function getEmailScriptPath(): string {
  return resolve(config.basePath, "send-email.sh");
}

export function getCredentialsPath(): string {
  return CREDENTIALS_PATH;
}

export function isEmailEnabled(): boolean {
  try {
    execFileSync("sudo", ["test", "-f", CREDENTIALS_PATH], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export function ensureCredentialsDir(): void {
  try {
    execFileSync("sudo", ["mkdir", "-p", CREDENTIALS_DIR], { timeout: 5000 });
    execFileSync("sudo", ["chmod", "700", CREDENTIALS_DIR], { timeout: 3000 });
    execFileSync("sudo", ["chown", "root:root", CREDENTIALS_DIR], { timeout: 3000 });
  } catch (err) {
    console.error("[email] Failed to create credentials directory:", err);
  }

  const legacyPath = resolve(config.basePath, LEGACY_CREDENTIALS_FILE);
  if (existsSync(legacyPath) && !isEmailEnabled()) {
    try {
      execFileSync("sudo", ["mv", legacyPath, CREDENTIALS_PATH], { timeout: 5000 });
      execFileSync("sudo", ["chmod", "600", CREDENTIALS_PATH], { timeout: 3000 });
      execFileSync("sudo", ["chown", "root:root", CREDENTIALS_PATH], { timeout: 3000 });
      console.log(`[email] Migrated ${legacyPath} → ${CREDENTIALS_PATH}`);
    } catch (err) {
      console.error("[email] Failed to migrate credentials:", err);
    }
  }
}

export function generateSendEmailScript(): void {
  const credPath = CREDENTIALS_PATH;
  const scriptPath = getEmailScriptPath();

  const script = `#!/usr/bin/env bash
set -euo pipefail

CRED_FILE="${credPath}"
TO="" SUBJECT="" BODY="" FROM="" HTML=false CC="" PROFILE="default"
ATTACHMENTS=()

while [[ \$# -gt 0 ]]; do
  case \$1 in
    --to)         TO="\$2"; shift 2;;
    --subject)    SUBJECT="\$2"; shift 2;;
    --body)       BODY="\$2"; shift 2;;
    --from)       FROM="\$2"; shift 2;;
    --html)       HTML=true; shift;;
    --cc)         CC="\$2"; shift 2;;
    --attachment) ATTACHMENTS+=("\$2"); shift 2;;
    *)            echo "Unknown option: \$1" >&2; exit 1;;
  esac
done

if [ -z "\$TO" ] || [ -z "\$SUBJECT" ] || [ -z "\$BODY" ]; then
  echo "Usage: send-email.sh --to <email> --subject <subject> --body <body> [--from <sender>] [--html] [--cc <email>] [--attachment <file> ...]" >&2
  exit 1
fi

for f in "\${ATTACHMENTS[@]+\${ATTACHMENTS[@]}}"; do
  if [ ! -f "\$f" ]; then
    echo "ERROR: Attachment not found: \$f" >&2
    exit 1
  fi
done

CRED_CONTENT=\$(sudo cat "\$CRED_FILE" 2>/dev/null)
if [ -z "\$CRED_CONTENT" ]; then
  echo "ERROR: Cannot read credentials file: \$CRED_FILE" >&2
  exit 1
fi

parse_profile() {
  local profile="\$1" key="\$2"
  echo "\$CRED_CONTENT" | sed -n "/^\\[\$profile\\]/,/^\\[/p" | grep "^\$key=" | head -1 | cut -d= -f2-
}

if [ -n "\$FROM" ]; then
  PROFILE=\$(echo "\$CRED_CONTENT" | awk -v from="\$FROM" '/^\\[/{p=substr(\$0,2,length(\$0)-2)} \$0=="from="from{print p; exit}' || true)
  if [ -z "\$PROFILE" ]; then
    echo "ERROR: No credentials found for sender \$FROM" >&2
    exit 1
  fi
fi

export AWS_ACCESS_KEY_ID=\$(parse_profile "\$PROFILE" aws_access_key_id)
export AWS_SECRET_ACCESS_KEY=\$(parse_profile "\$PROFILE" aws_secret_access_key)
REGION=\$(parse_profile "\$PROFILE" region)
[ -z "\$FROM" ] && FROM=\$(parse_profile "\$PROFILE" from)

if [ -z "\$AWS_ACCESS_KEY_ID" ] || [ -z "\$AWS_SECRET_ACCESS_KEY" ] || [ -z "\$REGION" ] || [ -z "\$FROM" ]; then
  echo "ERROR: Incomplete credentials for profile [\$PROFILE]" >&2
  exit 1
fi

SENDER_NAME=\$(parse_profile "\$PROFILE" sender_name)
if [ -n "\$SENDER_NAME" ]; then
  FROM_HEADER="\$SENDER_NAME <\$FROM>"
else
  FROM_HEADER="\$FROM"
fi

if [ \${#ATTACHMENTS[@]} -eq 0 ]; then
  DEST="{\\"ToAddresses\\":[\\"\$TO\\"]}"
  if [ -n "\$CC" ]; then
    DEST="{\\"ToAddresses\\":[\\"\$TO\\"],\\"CcAddresses\\":[\\"\$CC\\"]}"
  fi

  SUBJ_ESC=\$(printf '%s' "\$SUBJECT" | jq -Rs .)
  BODY_ESC=\$(printf '%s' "\$BODY" | jq -Rs .)

  if [ "\$HTML" = true ]; then
    BODY_JSON="{\\"Html\\":{\\"Data\\":\$BODY_ESC,\\"Charset\\":\\"UTF-8\\"}}"
  else
    BODY_JSON="{\\"Text\\":{\\"Data\\":\$BODY_ESC,\\"Charset\\":\\"UTF-8\\"}}"
  fi

  MSG="{\\"Subject\\":{\\"Data\\":\$SUBJ_ESC,\\"Charset\\":\\"UTF-8\\"},\\"Body\\":\$BODY_JSON}"

  aws ses send-email \\
    --region "\$REGION" \\
    --from "\$FROM_HEADER" \\
    --destination "\$DEST" \\
    --message "\$MSG" \\
    --output json 2>&1
else
  BOUNDARY="boundary-\$(date +%s%N)-\$RANDOM"
  TMPFILE=\$(mktemp)
  trap "rm -f \$TMPFILE" EXIT

  {
    echo "From: \$FROM_HEADER"
    echo "To: \$TO"
    [ -n "\$CC" ] && echo "Cc: \$CC"
    echo "Subject: \$SUBJECT"
    echo "MIME-Version: 1.0"
    echo "Content-Type: multipart/mixed; boundary=\\"\$BOUNDARY\\""
    echo ""
    echo "--\$BOUNDARY"
    if [ "\$HTML" = true ]; then
      echo "Content-Type: text/html; charset=UTF-8"
    else
      echo "Content-Type: text/plain; charset=UTF-8"
    fi
    echo "Content-Transfer-Encoding: base64"
    echo ""
    printf '%s' "\$BODY" | base64
    echo ""
    for att in "\${ATTACHMENTS[@]}"; do
      FILENAME=\$(basename "\$att")
      MIME_TYPE=\$(file --mime-type -b "\$att" 2>/dev/null || echo "application/octet-stream")
      echo "--\$BOUNDARY"
      echo "Content-Type: \$MIME_TYPE; name=\\"\$FILENAME\\""
      echo "Content-Disposition: attachment; filename=\\"\$FILENAME\\""
      echo "Content-Transfer-Encoding: base64"
      echo ""
      base64 "\$att"
      echo ""
    done
    echo "--\$BOUNDARY--"
  } > "\$TMPFILE"

  JSONFILE=\$(mktemp)
  trap "rm -f \$TMPFILE \$JSONFILE" EXIT
  python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    data = f.read()
with open(sys.argv[2], 'w') as f:
    json.dump({'Data': data}, f)
" "\$TMPFILE" "\$JSONFILE"

  aws ses send-raw-email \\
    --region "\$REGION" \\
    --cli-binary-format raw-in-base64-out \\
    --raw-message file://"\$JSONFILE" \\
    --output json 2>&1
fi

echo "Email sent from \$FROM to \$TO"
`;

  writeFileSync(scriptPath, script, "utf-8");
  chmodSync(scriptPath, 0o755);
  console.log(`[email] Generated ${scriptPath}`);
}
