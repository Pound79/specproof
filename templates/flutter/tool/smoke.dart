import 'dart:io';

import 'package:yaml/yaml.dart';

// Flutter アプリを起動する前に、ホストでリポジトリの設定を読む。
File findConfig() {
  var dir = Directory.current;
  while (true) {
    for (final name in ['specproof.config.yaml', 'specproof.config.yml']) {
      final file = File.fromUri(dir.uri.resolve(name));
      if (file.existsSync()) return file;
    }
    final git = dir.uri.resolve('.git').toFilePath();
    if (FileSystemEntity.typeSync(git, followLinks: false) !=
            FileSystemEntityType.notFound ||
        dir.parent.path == dir.path) {
      throw StateError('Could not find specproof.config.yaml or .yml');
    }
    dir = dir.parent;
  }
}

Future<void> main(List<String> args) async {
  final config = loadYaml(findConfig().readAsStringSync());
  final slow = config['tags']?['slow'] ?? '@slow';
  const stateTags = {'@draft', '@red-contract', '@human', '@out-of-scope'};
  if (slow is! String ||
      !RegExp(r'^@\w[^@()&\s\\]*$').hasMatch(slow) ||
      stateTags.contains(slow)) {
    throw FormatException('tags.slow must be a single non-state tag');
  }

  final projects = config['projects'];
  if (projects is! List || projects.isEmpty || projects.first is! Map) {
    throw FormatException('projects must have a default project for smoke');
  }
  final extra = projects.first['tags'] ?? '';
  if (extra is! String)
    throw FormatException('projects[0].tags must be a string');
  final tags = extra.trim().isEmpty ? 'not $slow' : '($extra) and not $slow';
  final process = await Process.start(
    Platform.isWindows ? 'flutter.bat' : 'flutter',
    ['test', ...args, '--dart-define=SPECPROOF_TAGS=$tags'],
    mode: ProcessStartMode.inheritStdio,
  );
  exitCode = await process.exitCode;
}
