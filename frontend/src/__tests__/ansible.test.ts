import { describe, it, expect } from 'vitest';
import {
  parseAnsibleLine,
  getLineType,
  extractHost,
  extractTaskName,
  parseRecapLine,
  colorizeAnsibleOutput,
  calculatePlaybookStats,
  parseTaskPath,
  matchErrorPattern,
  ANSIBLE_ERROR_PATTERNS,
} from '../utils/ansible';
import type { AnsibleLineType, RecapInfo, PlaybookStats } from '../utils/ansible';

// ---------------------------------------------------------------------------
// Sample ansible-playbook output
// ---------------------------------------------------------------------------
const SAMPLE_OUTPUT = [
  'PLAY [Install AAP on gateway] *************************************************',
  '',
  'TASK [Gathering Facts] ********************************************************',
  'ok: [gateway.example.com]',
  '',
  'TASK [ansible.aap_install.preflight : Check disk space] ***********************',
  'ok: [gateway.example.com]',
  '',
  'TASK [ansible.aap_install.preflight : Check memory] **************************',
  'changed: [gateway.example.com]',
  '',
  'TASK [ansible.aap_install.postgres : Install PostgreSQL] *********************',
  'changed: [db.example.com]',
  '',
  'TASK [ansible.aap_install.controller : Configure controller] *****************',
  'skipping: [gateway.example.com]',
  '',
  'TASK [ansible.aap_install.hub : Sync collections] ****************************',
  'fatal: [hub.example.com]: FAILED! => {"msg": "Connection refused"}',
  '',
  'TASK [ansible.aap_install.eda : Start EDA services] **************************',
  'fatal: [eda.example.com]: UNREACHABLE! => {"msg": "No route to host"}',
  '',
  'RUNNING HANDLER [ansible.aap_install.gateway : Restart nginx] ****************',
  'ok: [gateway.example.com]',
  '',
  '[WARNING]: Found variable using reserved name: name',
  '',
  'PLAY RECAP *********************************************************************',
  'gateway.example.com        : ok=5    changed=1    unreachable=0    failed=0    skipped=1    rescued=0    ignored=0',
  'db.example.com             : ok=3    changed=1    unreachable=0    failed=0    skipped=0    rescued=0    ignored=0',
  'hub.example.com            : ok=2    changed=0    unreachable=0    failed=1    skipped=0    rescued=0    ignored=0',
  'eda.example.com            : ok=0    changed=0    unreachable=1    failed=0    skipped=0    rescued=0    ignored=0',
];

// ---------------------------------------------------------------------------
// getLineType
// ---------------------------------------------------------------------------
describe('getLineType', () => {
  it('detects play lines', () => {
    expect(getLineType('PLAY [Install AAP on gateway] **************')).toBe('play');
  });

  it('detects task lines', () => {
    expect(getLineType('TASK [Gathering Facts] ***********************')).toBe('task');
  });

  it('detects ok lines', () => {
    expect(getLineType('ok: [gateway.example.com]')).toBe('ok');
  });

  it('detects changed lines', () => {
    expect(getLineType('changed: [gateway.example.com]')).toBe('changed');
  });

  it('detects failed lines', () => {
    expect(getLineType('fatal: [hub.example.com]: FAILED! => {"msg": "Connection refused"}')).toBe('failed');
  });

  it('detects skipped lines', () => {
    expect(getLineType('skipping: [gateway.example.com]')).toBe('skipped');
  });

  it('detects unreachable lines', () => {
    expect(getLineType('fatal: [eda.example.com]: UNREACHABLE! => {"msg": "No route to host"}')).toBe('unreachable');
  });

  it('detects recap lines', () => {
    expect(getLineType('PLAY RECAP *************************************')).toBe('recap');
    expect(getLineType('gateway.example.com : ok=5 changed=1 unreachable=0 failed=0 skipped=1 rescued=0 ignored=0')).toBe('recap');
  });

  it('detects handler lines', () => {
    expect(getLineType('RUNNING HANDLER [ansible.aap_install.gateway : Restart nginx] ***')).toBe('handler');
  });

  it('detects included lines', () => {
    expect(getLineType('included: /path/to/role/tasks/main.yml for host1')).toBe('included');
  });

  it('detects warning lines', () => {
    expect(getLineType('[WARNING]: Found variable using reserved name: name')).toBe('warning');
  });

  it('detects error lines', () => {
    expect(getLineType('ERROR! the role \'missing_role\' was not found')).toBe('error');
  });

  it('returns other for unrecognized lines', () => {
    expect(getLineType('')).toBe('other');
    expect(getLineType('some random output')).toBe('other');
  });

  it('handles leading whitespace', () => {
    expect(getLineType('  ok: [host1]')).toBe('ok');
    expect(getLineType('    changed: [host1]')).toBe('changed');
  });
});

// ---------------------------------------------------------------------------
// extractHost
// ---------------------------------------------------------------------------
describe('extractHost', () => {
  it('extracts host from ok line', () => {
    expect(extractHost('ok: [gateway.example.com]')).toBe('gateway.example.com');
  });

  it('extracts host from changed line', () => {
    expect(extractHost('changed: [db.example.com]')).toBe('db.example.com');
  });

  it('extracts host from failed line', () => {
    expect(extractHost('fatal: [hub.example.com]: FAILED! => {"msg": "error"}')).toBe('hub.example.com');
  });

  it('extracts host from unreachable line', () => {
    expect(extractHost('fatal: [eda.example.com]: UNREACHABLE! => {"msg": "No route"}')).toBe('eda.example.com');
  });

  it('extracts host from skipping line', () => {
    expect(extractHost('skipping: [gateway.example.com]')).toBe('gateway.example.com');
  });

  it('returns null for non-result lines', () => {
    expect(extractHost('TASK [Gathering Facts] ***')).toBeNull();
    expect(extractHost('PLAY [test] ***')).toBeNull();
    expect(extractHost('')).toBeNull();
  });

  it('handles IP addresses as hosts', () => {
    expect(extractHost('ok: [192.168.1.100]')).toBe('192.168.1.100');
  });
});

// ---------------------------------------------------------------------------
// extractTaskName
// ---------------------------------------------------------------------------
describe('extractTaskName', () => {
  it('extracts from TASK line', () => {
    expect(extractTaskName('TASK [Gathering Facts] *****')).toBe('Gathering Facts');
  });

  it('extracts from FQCN task name', () => {
    expect(extractTaskName('TASK [ansible.aap_install.preflight : Check disk space] ***')).toBe(
      'ansible.aap_install.preflight : Check disk space',
    );
  });

  it('extracts from handler line', () => {
    expect(extractTaskName('RUNNING HANDLER [ansible.aap_install.gateway : Restart nginx] ***')).toBe(
      'ansible.aap_install.gateway : Restart nginx',
    );
  });

  it('returns null for non-task lines', () => {
    expect(extractTaskName('ok: [host1]')).toBeNull();
    expect(extractTaskName('PLAY [test] ***')).toBeNull();
    expect(extractTaskName('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseRecapLine
// ---------------------------------------------------------------------------
describe('parseRecapLine', () => {
  it('parses a standard recap line', () => {
    const recap = parseRecapLine(
      'gateway.example.com        : ok=5    changed=1    unreachable=0    failed=0    skipped=1    rescued=0    ignored=0',
    );
    expect(recap).not.toBeNull();
    expect(recap!.host).toBe('gateway.example.com');
    expect(recap!.ok).toBe(5);
    expect(recap!.changed).toBe(1);
    expect(recap!.unreachable).toBe(0);
    expect(recap!.failed).toBe(0);
    expect(recap!.skipped).toBe(1);
    expect(recap!.rescued).toBe(0);
    expect(recap!.ignored).toBe(0);
  });

  it('parses recap with all non-zero values', () => {
    const recap = parseRecapLine(
      'host1.test : ok=10 changed=3 unreachable=1 failed=2 skipped=4 rescued=1 ignored=5',
    );
    expect(recap).not.toBeNull();
    expect(recap!.ok).toBe(10);
    expect(recap!.failed).toBe(2);
    expect(recap!.rescued).toBe(1);
    expect(recap!.ignored).toBe(5);
  });

  it('returns null for non-recap lines', () => {
    expect(parseRecapLine('PLAY RECAP ****')).toBeNull();
    expect(parseRecapLine('ok: [host1]')).toBeNull();
    expect(parseRecapLine('')).toBeNull();
  });

  it('parses IP-addressed recap', () => {
    const recap = parseRecapLine(
      '192.168.1.1 : ok=2 changed=0 unreachable=0 failed=0 skipped=0 rescued=0 ignored=0',
    );
    expect(recap).not.toBeNull();
    expect(recap!.host).toBe('192.168.1.1');
    expect(recap!.ok).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// parseAnsibleLine
// ---------------------------------------------------------------------------
describe('parseAnsibleLine', () => {
  it('parses ok line with host', () => {
    const info = parseAnsibleLine('ok: [gateway.example.com]');
    expect(info.type).toBe('ok');
    expect(info.host).toBe('gateway.example.com');
    expect(info.changed).toBe(false);
  });

  it('parses changed line', () => {
    const info = parseAnsibleLine('changed: [db.example.com]');
    expect(info.type).toBe('changed');
    expect(info.host).toBe('db.example.com');
    expect(info.changed).toBe(true);
  });

  it('parses task line with task name', () => {
    const info = parseAnsibleLine('TASK [Install packages] ***');
    expect(info.type).toBe('task');
    expect(info.taskName).toBe('Install packages');
  });

  it('preserves raw line', () => {
    const raw = 'ok: [host1]';
    const info = parseAnsibleLine(raw);
    expect(info.raw).toBe(raw);
  });
});

// ---------------------------------------------------------------------------
// colorizeAnsibleOutput
// ---------------------------------------------------------------------------
describe('colorizeAnsibleOutput', () => {
  it('assigns correct class for ok lines', () => {
    const result = colorizeAnsibleOutput('ok: [host1]');
    expect(result.className).toBe('ansible-ok');
    expect(result.text).toBe('ok: [host1]');
  });

  it('assigns correct class for failed lines', () => {
    const result = colorizeAnsibleOutput('fatal: [host1]: FAILED! => {}');
    expect(result.className).toBe('ansible-failed');
  });

  it('assigns correct class for changed lines', () => {
    const result = colorizeAnsibleOutput('changed: [host1]');
    expect(result.className).toBe('ansible-changed');
  });

  it('assigns correct class for warning lines', () => {
    const result = colorizeAnsibleOutput('[WARNING]: something');
    expect(result.className).toBe('ansible-warning');
  });

  it('assigns other class for unknown lines', () => {
    const result = colorizeAnsibleOutput('random output');
    expect(result.className).toBe('ansible-other');
  });

  it('assigns correct class for play lines', () => {
    const result = colorizeAnsibleOutput('PLAY [test] ***');
    expect(result.className).toBe('ansible-play');
  });

  it('assigns correct class for task lines', () => {
    const result = colorizeAnsibleOutput('TASK [test] ***');
    expect(result.className).toBe('ansible-task');
  });
});

// ---------------------------------------------------------------------------
// calculatePlaybookStats
// ---------------------------------------------------------------------------
describe('calculatePlaybookStats', () => {
  it('calculates stats from sample output', () => {
    const stats = calculatePlaybookStats(SAMPLE_OUTPUT);

    expect(stats.plays).toBe(1);
    expect(stats.hosts.length).toBe(4);
    expect(stats.hosts).toContain('gateway.example.com');
    expect(stats.hosts).toContain('db.example.com');
    expect(stats.hosts).toContain('hub.example.com');
    expect(stats.hosts).toContain('eda.example.com');
    expect(stats.recaps).toHaveLength(4);
  });

  it('uses recap data for final counts', () => {
    const stats = calculatePlaybookStats(SAMPLE_OUTPUT);

    expect(stats.okTasks).toBe(10);
    expect(stats.changedTasks).toBe(2);
    expect(stats.failedTasks).toBe(1);
    expect(stats.unreachableTasks).toBe(1);
    expect(stats.skippedTasks).toBe(1);
  });

  it('handles empty input', () => {
    const stats = calculatePlaybookStats([]);
    expect(stats.plays).toBe(0);
    expect(stats.totalTasks).toBe(0);
    expect(stats.hosts).toEqual([]);
  });

  it('counts plays correctly with multiple plays', () => {
    const lines = [
      'PLAY [First play] ***',
      'TASK [Task 1] ***',
      'ok: [host1]',
      'PLAY [Second play] ***',
      'TASK [Task 2] ***',
      'changed: [host1]',
    ];
    const stats = calculatePlaybookStats(lines);
    expect(stats.plays).toBe(2);
  });

  it('handles output without recap', () => {
    const lines = [
      'TASK [Gathering Facts] ***',
      'ok: [host1]',
      'ok: [host2]',
      'changed: [host1]',
    ];
    const stats = calculatePlaybookStats(lines);
    expect(stats.okTasks).toBe(2);
    expect(stats.changedTasks).toBe(1);
    expect(stats.totalTasks).toBe(3);
    expect(stats.hosts).toContain('host1');
    expect(stats.hosts).toContain('host2');
  });
});

// ---------------------------------------------------------------------------
// parseTaskPath
// ---------------------------------------------------------------------------
describe('parseTaskPath', () => {
  it('parses FQCN task path', () => {
    const result = parseTaskPath('ansible.aap_install.preflight : Check disk space');
    expect(result.collection).toBe('ansible.aap_install');
    expect(result.role).toBe('preflight');
    expect(result.task).toBe('Check disk space');
  });

  it('parses role-only task path', () => {
    const result = parseTaskPath('my_role : Install packages');
    expect(result.role).toBe('my_role');
    expect(result.task).toBe('Install packages');
    expect(result.collection).toBeUndefined();
  });

  it('parses plain task name', () => {
    const result = parseTaskPath('Gathering Facts');
    expect(result.task).toBe('Gathering Facts');
    expect(result.collection).toBeUndefined();
    expect(result.role).toBeUndefined();
  });

  it('handles dotted role names', () => {
    const result = parseTaskPath('my.custom.role : Do thing');
    expect(result.collection).toBe('my.custom');
    expect(result.role).toBe('role');
    expect(result.task).toBe('Do thing');
  });

  it('handles complex task names with colons', () => {
    const result = parseTaskPath('Install packages');
    expect(result.task).toBe('Install packages');
  });
});

// ---------------------------------------------------------------------------
// matchErrorPattern
// ---------------------------------------------------------------------------
describe('matchErrorPattern', () => {
  it('matches SSH key error', () => {
    const match = matchErrorPattern('Permission denied (publickey,gssapi-keyex,gssapi-with-mic)');
    expect(match).not.toBeNull();
    expect(match!.title).toBe('SSH Key Authentication Failed');
    expect(match!.suggestion).toBeTruthy();
  });

  it('matches connection timeout', () => {
    const match = matchErrorPattern('fatal: [host1]: UNREACHABLE! Connection timed out');
    expect(match).not.toBeNull();
    expect(match!.title).toBe('Connection Timeout');
  });

  it('matches DNS resolution failure', () => {
    const match = matchErrorPattern('Name or service not known for host bad.example.com');
    expect(match).not.toBeNull();
    expect(match!.title).toBe('DNS Resolution Failed');
  });

  it('matches database auth failure', () => {
    const match = matchErrorPattern('FATAL: password authentication failed for user "controller"');
    expect(match).not.toBeNull();
    expect(match!.title).toBe('Database Authentication Failed');
  });

  it('matches disk space errors', () => {
    const match = matchErrorPattern('No space left on device');
    expect(match).not.toBeNull();
    expect(match!.title).toBe('Insufficient Disk Space');
  });

  it('matches out of memory', () => {
    const match = matchErrorPattern('Cannot allocate memory');
    expect(match).not.toBeNull();
    expect(match!.title).toBe('Out of Memory');
  });

  it('matches TLS certificate error', () => {
    const match = matchErrorPattern('SSL: CERTIFICATE_VERIFY_FAILED');
    expect(match).not.toBeNull();
    expect(match!.title).toBe('TLS Certificate Verification Failed');
  });

  it('matches container image pull error', () => {
    const match = matchErrorPattern('container pull error: manifest unknown');
    expect(match).not.toBeNull();
    expect(match!.title).toBe('Container Image Pull Failed');
  });

  it('matches SELinux denial', () => {
    const match = matchErrorPattern('avc:  denied  { write } for pid=1234');
    expect(match).not.toBeNull();
    expect(match!.title).toBe('SELinux Denial');
  });

  it('matches port conflict', () => {
    const match = matchErrorPattern('Address already in use: port 443');
    expect(match).not.toBeNull();
    expect(match!.title).toBe('Port Already in Use');
  });

  it('matches Python not found', () => {
    const match = matchErrorPattern('/usr/bin/python: No such file or directory');
    expect(match).not.toBeNull();
    expect(match!.title).toBe('Python Not Found');
  });

  it('matches sudo password required', () => {
    const match = matchErrorPattern('Missing sudo password');
    expect(match).not.toBeNull();
    expect(match!.title).toBe('Sudo Password Required');
  });

  it('matches connection refused', () => {
    const match = matchErrorPattern('Connection refused on port 22');
    expect(match).not.toBeNull();
    expect(match!.title).toBe('Connection Refused');
  });

  it('matches module failure', () => {
    const match = matchErrorPattern('MODULE FAILURE: unexpected error in module');
    expect(match).not.toBeNull();
    expect(match!.title).toBe('Ansible Module Failure');
  });

  it('matches no route to host', () => {
    const match = matchErrorPattern('No route to host');
    expect(match).not.toBeNull();
    expect(match!.title).toBe('Host Unreachable');
  });

  it('returns null for unrecognized errors', () => {
    expect(matchErrorPattern('everything is fine')).toBeNull();
    expect(matchErrorPattern('')).toBeNull();
  });

  it('provides all three fields for each match', () => {
    for (const pattern of ANSIBLE_ERROR_PATTERNS) {
      expect(pattern.title).toBeTruthy();
      expect(pattern.explanation).toBeTruthy();
      expect(pattern.suggestion).toBeTruthy();
    }
  });

  it('has at least 20 error patterns', () => {
    expect(ANSIBLE_ERROR_PATTERNS.length).toBeGreaterThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------
// ANSIBLE_ERROR_PATTERNS structure
// ---------------------------------------------------------------------------
describe('ANSIBLE_ERROR_PATTERNS', () => {
  it('each pattern has a valid RegExp', () => {
    for (const entry of ANSIBLE_ERROR_PATTERNS) {
      expect(entry.pattern).toBeInstanceOf(RegExp);
    }
  });

  it('each pattern has non-empty title, explanation, and suggestion', () => {
    for (const entry of ANSIBLE_ERROR_PATTERNS) {
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.explanation.length).toBeGreaterThan(10);
      expect(entry.suggestion.length).toBeGreaterThan(10);
    }
  });

  it('has unique titles', () => {
    const titles = ANSIBLE_ERROR_PATTERNS.map((p) => p.title);
    const unique = new Set(titles);
    expect(unique.size).toBe(titles.length);
  });
});
