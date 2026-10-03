Feature: Native contract
  Background:
    Given shared state
      """text/plain
      shared text
      """

  @smoke
  Rule: Values
    Background:
      Given rule state
        | key | value |
        | a   | b     |

    @AC-001 @red-contract
    Scenario Outline: value <input>
      Given input <input>
      When it is read
        """text/plain
        request <input>
        """
      Then result is <output>

      @slow
      Examples: first
        | input | output |
        | one   | yes    |

      Examples: second
        | input | output |
        | two   | no     |
        | three | yes    |

    @AC-002
    Scenario: unchanged condition
      Given input fixed
      Then result is yes
