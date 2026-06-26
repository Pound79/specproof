import 'package:flutter/material.dart';

/// Self-contained widget used by the BDD pipeline smoke test, so the first
/// Japanese-Gherkin green does not depend on the app's maps/location plugins.
class CounterApp extends StatefulWidget {
  const CounterApp({super.key});

  @override
  State<CounterApp> createState() => _CounterAppState();
}

class _CounterAppState extends State<CounterApp> {
  int _count = 0;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: Scaffold(
        appBar: AppBar(title: const Text('カウンター')),
        body: Center(
          child: Text('$_count', style: Theme.of(context).textTheme.headlineMedium),
        ),
        floatingActionButton: FloatingActionButton(
          onPressed: () => setState(() => _count++),
          tooltip: '+',
          child: const Icon(Icons.add),
        ),
      ),
    );
  }
}
