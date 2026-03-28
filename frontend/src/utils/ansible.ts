export type AnsibleLineType =
  | 'play'
  | 'task'
  | 'ok'
  | 'changed'
  | 'failed'
  | 'skipped'
  | 'unreachable'
  | 'recap'
  | 'handler'
  | 'included'
  | 'warning'
  | 'error'
  | 'other';

export interface AnsibleLineInfo {
  raw: string;
  type: AnsibleLineType;
  host?: string;
  taskName?: string;
  changed?: boolean;
  timestamp?: string;
}

export interface RecapInfo {
  host: string;
  ok: number;
  changed: number;
  unreachable: number;
  failed: number;
  skipped: number;
  rescued: number;
  ignored: number;
}

export interface PlaybookStats {
  totalTasks: number;
  okTasks: number;
  changedTasks: number;
  failedTasks: number;
  skippedTasks: number;
  unreachableTasks: number;
  hosts: string[];
  duration: number;
  plays: number;
  recaps: RecapInfo[];
}

export interface ErrorMatch {
  pattern: string;
  title: string;
  explanation: string;
  suggestion: string;
}

export interface AnsibleErrorPattern {
  pattern: RegExp;
  title: string;
  explanation: string;
  suggestion: string;
}

const PLAY_RE = /^PLAY \[(.+)\]/;
const TASK_RE = /^TASK \[(.+)\]/;
const HANDLER_RE = /^(?:RUNNING |NOTIFIED )?HANDLER \[(.+)\]/;
const OK_RE = /^ok: \[([^\]]+)\]/;
const CHANGED_RE = /^changed: \[([^\]]+)\]/;
const FAILED_RE = /^fatal: \[([^\]]+)\]:/;
const SKIPPED_RE = /^skipping: \[([^\]]+)\]/;
const UNREACHABLE_RE = /^fatal: \[([^\]]+)\]: UNREACHABLE!/;
const INCLUDED_RE = /^included: /;
const RECAP_HEADER_RE = /^PLAY RECAP \*+/;
const RECAP_LINE_RE = /^(\S+)\s+:\s+ok=(\d+)\s+changed=(\d+)\s+unreachable=(\d+)\s+failed=(\d+)\s+skipped=(\d+)\s+rescued=(\d+)\s+ignored=(\d+)/;
const WARNING_RE = /^\[WARNING\]/;
const ERROR_RE = /^ERROR!|^fatal:/;

export function getLineType(line: string): AnsibleLineType {
  const trimmed = line.trimStart();

  if (UNREACHABLE_RE.test(trimmed)) return 'unreachable';
  if (PLAY_RE.test(trimmed)) return 'play';
  if (TASK_RE.test(trimmed)) return 'task';
  if (HANDLER_RE.test(trimmed)) return 'handler';
  if (OK_RE.test(trimmed)) return 'ok';
  if (CHANGED_RE.test(trimmed)) return 'changed';
  if (FAILED_RE.test(trimmed)) return 'failed';
  if (SKIPPED_RE.test(trimmed)) return 'skipped';
  if (INCLUDED_RE.test(trimmed)) return 'included';
  if (RECAP_HEADER_RE.test(trimmed) || RECAP_LINE_RE.test(trimmed)) return 'recap';
  if (WARNING_RE.test(trimmed)) return 'warning';
  if (ERROR_RE.test(trimmed)) return 'error';

  return 'other';
}

export function extractHost(line: string): string | null {
  const trimmed = line.trimStart();

  for (const re of [UNREACHABLE_RE, OK_RE, CHANGED_RE, FAILED_RE, SKIPPED_RE]) {
    const m = trimmed.match(re);
    if (m) return m[1];
  }

  return null;
}

export function extractTaskName(line: string): string | null {
  const trimmed = line.trimStart();

  const taskMatch = trimmed.match(TASK_RE);
  if (taskMatch) return taskMatch[1];

  const handlerMatch = trimmed.match(HANDLER_RE);
  if (handlerMatch) return handlerMatch[1];

  return null;
}

export function parseRecapLine(line: string): RecapInfo | null {
  const m = line.trimStart().match(RECAP_LINE_RE);
  if (!m) return null;

  return {
    host: m[1],
    ok: parseInt(m[2], 10),
    changed: parseInt(m[3], 10),
    unreachable: parseInt(m[4], 10),
    failed: parseInt(m[5], 10),
    skipped: parseInt(m[6], 10),
    rescued: parseInt(m[7], 10),
    ignored: parseInt(m[8], 10),
  };
}

export function parseAnsibleLine(line: string): AnsibleLineInfo {
  const type = getLineType(line);

  const info: AnsibleLineInfo = {
    raw: line,
    type,
  };

  info.host = extractHost(line) ?? undefined;
  info.taskName = extractTaskName(line) ?? undefined;
  info.changed = type === 'changed';

  return info;
}

const LINE_TYPE_CLASSES: Record<AnsibleLineType, string> = {
  play: 'ansible-play',
  task: 'ansible-task',
  ok: 'ansible-ok',
  changed: 'ansible-changed',
  failed: 'ansible-failed',
  skipped: 'ansible-skipped',
  unreachable: 'ansible-unreachable',
  recap: 'ansible-recap',
  handler: 'ansible-handler',
  included: 'ansible-included',
  warning: 'ansible-warning',
  error: 'ansible-error',
  other: 'ansible-other',
};

export function colorizeAnsibleOutput(line: string): { text: string; className: string } {
  const type = getLineType(line);
  return {
    text: line,
    className: LINE_TYPE_CLASSES[type],
  };
}

export function calculatePlaybookStats(lines: string[]): PlaybookStats {
  const stats: PlaybookStats = {
    totalTasks: 0,
    okTasks: 0,
    changedTasks: 0,
    failedTasks: 0,
    skippedTasks: 0,
    unreachableTasks: 0,
    hosts: [],
    duration: 0,
    plays: 0,
    recaps: [],
  };

  const hostSet = new Set<string>();

  for (const line of lines) {
    const type = getLineType(line);

    switch (type) {
      case 'play':
        stats.plays++;
        break;
      case 'ok':
        stats.okTasks++;
        stats.totalTasks++;
        break;
      case 'changed':
        stats.changedTasks++;
        stats.totalTasks++;
        break;
      case 'failed':
        stats.failedTasks++;
        stats.totalTasks++;
        break;
      case 'skipped':
        stats.skippedTasks++;
        stats.totalTasks++;
        break;
      case 'unreachable':
        stats.unreachableTasks++;
        stats.totalTasks++;
        break;
    }

    const host = extractHost(line);
    if (host) hostSet.add(host);

    const recap = parseRecapLine(line);
    if (recap) {
      stats.recaps.push(recap);
      hostSet.add(recap.host);
    }
  }

  stats.hosts = Array.from(hostSet).sort();

  if (stats.recaps.length > 0) {
    stats.okTasks = stats.recaps.reduce((s, r) => s + r.ok, 0);
    stats.changedTasks = stats.recaps.reduce((s, r) => s + r.changed, 0);
    stats.failedTasks = stats.recaps.reduce((s, r) => s + r.failed, 0);
    stats.skippedTasks = stats.recaps.reduce((s, r) => s + r.skipped, 0);
    stats.unreachableTasks = stats.recaps.reduce((s, r) => s + r.unreachable, 0);
    stats.totalTasks = stats.okTasks + stats.changedTasks + stats.failedTasks + stats.skippedTasks + stats.unreachableTasks;
  }

  return stats;
}

export function parseTaskPath(taskName: string): { collection?: string; role?: string; task: string } {
  const fqdnMatch = taskName.match(/^(\w+\.\w+\.\w+)\s*:\s*(.+)$/);
  if (fqdnMatch) {
    const fqcn = fqdnMatch[1];
    const remainder = fqdnMatch[2].trim();
    const parts = fqcn.split('.');
    return {
      collection: `${parts[0]}.${parts[1]}`,
      role: parts[2],
      task: remainder,
    };
  }

  const roleMatch = taskName.match(/^(\w[\w.-]+)\s*:\s*(.+)$/);
  if (roleMatch) {
    return {
      role: roleMatch[1],
      task: roleMatch[2].trim(),
    };
  }

  return { task: taskName };
}

export const ANSIBLE_ERROR_PATTERNS: AnsibleErrorPattern[] = [
  {
    pattern: /Permission denied \(publickey/i,
    title: 'SSH Key Authentication Failed',
    explanation: 'The target host rejected the SSH key. The key may not be installed on the remote host or has incorrect permissions.',
    suggestion: 'Verify the SSH key is in the remote user\'s ~/.ssh/authorized_keys and that ~/.ssh permissions are 700 and the key file is 600.',
  },
  {
    pattern: /No route to host/i,
    title: 'Host Unreachable',
    explanation: 'The network path to the target host could not be found. The host may be down or a firewall is blocking traffic.',
    suggestion: 'Check that the host is powered on, the IP/hostname is correct, and firewall rules allow SSH (port 22) traffic.',
  },
  {
    pattern: /Connection timed out/i,
    title: 'Connection Timeout',
    explanation: 'The SSH connection to the target host timed out. The host may be unreachable or a network device is dropping packets.',
    suggestion: 'Verify network connectivity with ping, check firewall rules, and ensure sshd is running on the target host.',
  },
  {
    pattern: /Connection refused/i,
    title: 'Connection Refused',
    explanation: 'The target host actively refused the SSH connection. The SSH service may not be running.',
    suggestion: 'Ensure sshd is running on the target host: systemctl status sshd. Check it is listening on the expected port.',
  },
  {
    pattern: /Name or service not known/i,
    title: 'DNS Resolution Failed',
    explanation: 'The hostname could not be resolved to an IP address. DNS may be misconfigured or the hostname is incorrect.',
    suggestion: 'Verify the hostname in your inventory, check /etc/resolv.conf, and test with: nslookup <hostname>.',
  },
  {
    pattern: /Shared connection to .+ closed/i,
    title: 'SSH Connection Dropped',
    explanation: 'The SSH connection was unexpectedly closed during task execution. The remote process may have been killed or the host rebooted.',
    suggestion: 'Check the target host for OOM kills (dmesg), disk space issues (df -h), and review /var/log/messages for errors.',
  },
  {
    pattern: /MODULE FAILURE/i,
    title: 'Ansible Module Failure',
    explanation: 'An Ansible module encountered an unhandled exception on the remote host.',
    suggestion: 'Run the playbook with -vvv for detailed output. Check that Python is installed on the target and module dependencies are met.',
  },
  {
    pattern: /Could not find or access '.*'/i,
    title: 'File Not Found',
    explanation: 'A required file or directory does not exist or is not accessible on the target host.',
    suggestion: 'Verify the file path exists and the Ansible user has read permissions. Check for typos in the path.',
  },
  {
    pattern: /Disk space.*insufficient|No space left on device/i,
    title: 'Insufficient Disk Space',
    explanation: 'The target host does not have enough free disk space to complete the operation.',
    suggestion: 'Free up disk space on the target host. AAP requires at least 40GB free. Check usage with: df -h.',
  },
  {
    pattern: /out of memory|oom|Cannot allocate memory/i,
    title: 'Out of Memory',
    explanation: 'The target host ran out of available RAM during the operation.',
    suggestion: 'Increase available memory or add swap space. AAP controller nodes need at least 16GB RAM.',
  },
  {
    pattern: /FAILED! => {"msg": "The task includes an option with an undefined variable/i,
    title: 'Undefined Variable',
    explanation: 'A Jinja2 variable referenced in a task was not defined in any variable source.',
    suggestion: 'Check your inventory and group_vars for the missing variable. Ensure all required variables are set in the wizard.',
  },
  {
    pattern: /password authentication failed for user/i,
    title: 'Database Authentication Failed',
    explanation: 'PostgreSQL rejected the connection because the username or password is incorrect.',
    suggestion: 'Verify the database credentials in the wizard. For external databases, confirm the user exists and has the correct password.',
  },
  {
    pattern: /could not connect to server.*Is the server running/i,
    title: 'Database Connection Failed',
    explanation: 'Could not establish a connection to the PostgreSQL server. It may not be running or the host/port is wrong.',
    suggestion: 'Ensure PostgreSQL is running: systemctl status postgresql. Verify host and port, and check pg_hba.conf allows connections.',
  },
  {
    pattern: /role ".*" does not exist/i,
    title: 'Database Role Missing',
    explanation: 'The specified PostgreSQL role (user) does not exist in the database.',
    suggestion: 'Create the role manually: CREATE ROLE <name> WITH LOGIN PASSWORD \'<pass>\'; or ensure the installer has admin privileges.',
  },
  {
    pattern: /database ".*" does not exist/i,
    title: 'Database Not Found',
    explanation: 'The specified PostgreSQL database does not exist on the server.',
    suggestion: 'Create the database: CREATE DATABASE <name> OWNER <user>; or switch to managed database mode so the installer creates it.',
  },
  {
    pattern: /certificate verify failed|SSL: CERTIFICATE_VERIFY_FAILED/i,
    title: 'TLS Certificate Verification Failed',
    explanation: 'The TLS/SSL certificate presented by the server could not be verified against trusted CAs.',
    suggestion: 'Ensure the CA certificate is correct and installed. For self-signed certs, provide the CA cert in the Network & TLS step.',
  },
  {
    pattern: /receptor.*failed to connect|receptor_ctl.*error/i,
    title: 'Receptor Connection Failed',
    explanation: 'The Receptor mesh network failed to establish a connection between nodes.',
    suggestion: 'Verify port 27199 (or custom receptor port) is open between all nodes. Check receptor service: systemctl status receptor.',
  },
  {
    pattern: /container.*pull.*error|ImagePullBackOff|ErrImagePull/i,
    title: 'Container Image Pull Failed',
    explanation: 'Failed to pull a required container image from the registry. Credentials may be invalid or the network is unreachable.',
    suggestion: 'Verify registry credentials in the Subscription step. For disconnected installs, ensure the bundle contains all images.',
  },
  {
    pattern: /ansible-galaxy.*collection.*error|Failed to resolve collection/i,
    title: 'Collection Installation Failed',
    explanation: 'One or more Ansible collections could not be installed from Galaxy or the local bundle.',
    suggestion: 'Check network access to galaxy.ansible.com. For disconnected installs, verify all collections are in the bundle directory.',
  },
  {
    pattern: /SELinux.*denied|avc:\s+denied/i,
    title: 'SELinux Denial',
    explanation: 'An SELinux security policy denied an operation required by the installer.',
    suggestion: 'Check SELinux audit logs: ausearch -m avc -ts recent. Apply the correct context or create a custom policy module.',
  },
  {
    pattern: /firewall.*error|iptables.*error|nftables.*error/i,
    title: 'Firewall Configuration Error',
    explanation: 'An error occurred while configuring the host firewall rules.',
    suggestion: 'Manually check firewall rules: firewall-cmd --list-all. Ensure required ports (443, 80, 27199, 5432) are allowed.',
  },
  {
    pattern: /systemctl.*failed|service.*failed to start|Job for .* failed/i,
    title: 'Service Start Failed',
    explanation: 'A system service failed to start after installation or configuration.',
    suggestion: 'Check the service status and logs: systemctl status <service> && journalctl -u <service> --no-pager -n 50.',
  },
  {
    pattern: /ENOSPC|write.*failed.*space/i,
    title: 'Write Failed — No Space',
    explanation: 'A write operation failed because the filesystem is full.',
    suggestion: 'Check disk usage (df -h) and clear space. Consider expanding the volume for /var and /opt partitions.',
  },
  {
    pattern: /python.*not found|\/usr\/bin\/python.*No such file/i,
    title: 'Python Not Found',
    explanation: 'The target host does not have Python installed or it is not at the expected path.',
    suggestion: 'Install Python 3.9+ on the target: dnf install python3. Or set ansible_python_interpreter in your inventory.',
  },
  {
    pattern: /sudo.*password.*required|Missing sudo password/i,
    title: 'Sudo Password Required',
    explanation: 'The remote user needs a password for sudo but none was provided or passwordless sudo is not configured.',
    suggestion: 'Configure passwordless sudo for the Ansible user: echo "<user> ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers.d/<user>.',
  },
  {
    pattern: /Timeout waiting for privilege escalation/i,
    title: 'Privilege Escalation Timeout',
    explanation: 'Ansible timed out waiting for the sudo password prompt or the escalation process hung.',
    suggestion: 'Ensure the user has passwordless sudo access or that the correct become password is configured.',
  },
  {
    pattern: /yum.*error|dnf.*error|rpm.*error|Package .* not available/i,
    title: 'Package Installation Failed',
    explanation: 'A required RPM package could not be installed. The repository may be unavailable or the package does not exist.',
    suggestion: 'Verify repo configuration: dnf repolist. For disconnected installs, ensure the local repository has all required packages.',
  },
  {
    pattern: /port.*already in use|Address already in use/i,
    title: 'Port Already in Use',
    explanation: 'A required network port is already being used by another process on the target host.',
    suggestion: 'Find the process using the port: ss -tlnp | grep <port>. Stop the conflicting service or change the port in the wizard.',
  },
];

export function matchErrorPattern(line: string): ErrorMatch | null {
  for (const entry of ANSIBLE_ERROR_PATTERNS) {
    if (entry.pattern.test(line)) {
      return {
        pattern: entry.pattern.source,
        title: entry.title,
        explanation: entry.explanation,
        suggestion: entry.suggestion,
      };
    }
  }
  return null;
}
