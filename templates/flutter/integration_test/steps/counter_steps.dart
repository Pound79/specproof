import 'package:flutter/material.dart';
import 'package:flutter_gherkin/flutter_gherkin.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gherkin/gherkin.dart';

// NOTE: Dart identifiers must be ASCII. Japanese appears ONLY inside the RegExp
// string literals. Patterns are NOT anchored, so they match whether or not the
// Japanese keyword (前提/もし/ならば) precedes the step text.

class AppIsRunning extends GivenWithWorld<FlutterWidgetTesterWorld> {
  @override
  RegExp get pattern => RegExp(r'カウンターアプリを起動している');

  @override
  Future<void> executeStep() async {
    final tester = world.rawAppDriver;
    await tester.pumpAndSettle();
    expect(find.byType(MaterialApp), findsOneWidget);
  }
}

class TapNamedButton extends When1WithWorld<String, FlutterWidgetTesterWorld> {
  @override
  RegExp get pattern => RegExp(r'"([^"]+)" ボタンをタップする');

  @override
  Future<void> executeStep(String label) async {
    final tester = world.rawAppDriver;
    await tester.tap(find.byTooltip(label));
    await tester.pumpAndSettle();
  }
}

class CountIsDisplayed extends Then1WithWorld<String, FlutterWidgetTesterWorld> {
  @override
  RegExp get pattern => RegExp(r'カウントは "([^"]+)" と表示される');

  @override
  Future<void> executeStep(String expected) async {
    expect(find.text(expected), findsOneWidget);
  }
}
