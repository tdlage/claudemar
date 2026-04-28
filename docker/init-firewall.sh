#!/usr/bin/env bash
set -euo pipefail

ANTHROPIC_IPS=$(getent ahostsv4 api.anthropic.com | awk '{print $1}' | sort -u)
STATSIG_IPS=$(getent ahostsv4 statsig.anthropic.com | awk '{print $1}' | sort -u)

iptables -P OUTPUT DROP
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT

for ip in $ANTHROPIC_IPS; do
  iptables -A OUTPUT -p tcp --dport 443 -d "$ip" -j ACCEPT
done

for ip in $STATSIG_IPS; do
  iptables -A OUTPUT -p tcp --dport 443 -d "$ip" -j ACCEPT
done
