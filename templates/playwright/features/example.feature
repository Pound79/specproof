# language: en
Feature: Login

  Scenario: Successful login with valid credentials
    Given I am on the login page
    When I log in with valid credentials
    Then I should see the application home page

  Scenario: Login fails with invalid credentials
    Given I am on the login page
    When I log in with invalid credentials
    Then I should see a login error message
