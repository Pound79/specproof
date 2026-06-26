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
Future<void> main() async {
  final runner = _CustomGherkinIntegrationTestRunner(
    configuration: FlutterTestConfiguration(
      featureDefaultLanguage: 'ja',
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
