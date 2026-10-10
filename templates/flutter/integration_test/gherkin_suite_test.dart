import 'package:flutter_gherkin/flutter_gherkin.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gherkin/gherkin.dart';
import 'package:integration_test/integration_test.dart';

import 'app/counter_app.dart';
import 'steps/counter_steps.dart';

part 'gherkin_suite_test.g.dart';

@GherkinTestSuite(
  featureDefaultLanguage: 'ja',
  featurePaths: ['integration_test/features/**.feature'],
)
// NOTE: rc.17's `executeTestSuite` is `void` and fire-and-forgets the async
// runner, which trips "Can't call group() once tests have begun running" under
// `flutter test`. We instead await the generated runner directly from an async
// main so the declaration phase stays open until all group()s are declared.
// Gherkin tag expression passed with --dart-define=SPECPROOF_TAGS=... (e.g. the
// smoke command passes "not @slow"). @draft (not decided yet), @human (a person
// checks it) and @out-of-scope (excluded) never run; @red-contract runs and stays
// red until implemented. There is deliberately no tag to switch a test off.
const _tagExpression = String.fromEnvironment('SPECPROOF_TAGS');
const _neverRun = 'not @draft and not @human and not @out-of-scope';
// State tags decide whether a scenario runs; SPECPROOF_TAGS may not mention them
// (it could silence @red-contract or select @draft / @human / @out-of-scope).
const _stateTags = ['@draft', '@red-contract', '@human', '@out-of-scope'];

bool _balanced(String expression) {
  var depth = 0;
  for (final char in expression.split('')) {
    if (char == '(') depth++;
    if (char == ')') depth--;
    if (depth < 0) return false;
  }
  return depth == 0;
}

Future<void> main() async {
  // An unbalanced parenthesis could escape the "(...) and not @draft ..." wrapper.
  if (_stateTags.any(_tagExpression.contains) || !_balanced(_tagExpression)) {
    throw StateError(
      'SPECPROOF_TAGS must not mention a state tag and must have balanced parentheses.',
    );
  }
  final runner = _CustomGherkinIntegrationTestRunner(
    configuration: FlutterTestConfiguration(
      featureDefaultLanguage: 'ja',
      tagExpression:
          _tagExpression.isEmpty ? _neverRun : '($_tagExpression) and $_neverRun',
      stepDefinitions: [
        AppIsRunning(),
        TapNamedButton(),
        CountIsDisplayed(),
      ],
    ),
    appMainFunction: (World world) async {
      final tester = (world as FlutterWidgetTesterWorld).rawAppDriver;
      await tester.pumpWidget(const CounterApp());
      await tester.pumpAndSettle();
    },
    scenarioExecutionTimeout: const Timeout(Duration(minutes: 10)),
  );
  await runner.run();
}
