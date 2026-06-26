import { Given, When, Then } from "../src/fixtures/test";

Given("I am on the login page", async ({ loginPage }) => {
  await loginPage.goto();
});

When("I log in with valid credentials", async ({ loginPage }) => {
  // TODO: replace with real test credentials sourced from env vars via credentialsFor()
  await loginPage.login("user@example.com", "password");
});

When("I log in with invalid credentials", async ({ loginPage }) => {
  await loginPage.login("user@example.com", "wrong-password");
});

Then("I should see the application home page", async ({ examplePage }) => {
  await examplePage.expectLoaded();
});

Then("I should see a login error message", async ({ loginPage }) => {
  await loginPage.expectError();
});
