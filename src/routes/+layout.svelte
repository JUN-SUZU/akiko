<script lang="ts">
  import { dev } from "$app/environment";
  import type { LayoutProps } from "./$types";
  import { setContext, onMount } from "svelte";
  import { base } from "$app/paths";
  import {
    STUDENT_SESSION,
    isStudentId,
    studentIdFromCookies,
    studentIdCookie,
    type StudentSession,
  } from "$lib/student-session";

  let { children }: LayoutProps = $props();
  let studentId = $state("");
  let studentIdInput = $state("");
  let cookieChecked = $state(false);
  setContext<StudentSession>(STUDENT_SESSION, {
    get studentId() {
      return studentId;
    },
  });

  onMount(() => {
    try {
      studentId = studentIdFromCookies(document.cookie) ?? "";
    } catch {
      studentId = "";
    }
    cookieChecked = true;
  });

  function identify(event: SubmitEvent) {
    event.preventDefault();
    if (isStudentId(studentIdInput)) {
      try {
        document.cookie = studentIdCookie(
          studentIdInput,
          base,
          window.location.protocol === "https:",
        );
      } catch {
        // Cookie restrictions must not prevent using the entered ID for this visit.
      }
      studentId = studentIdInput;
    }
  }
</script>

<svelte:head>
  {#if !dev}
    <script>
      var _paq = (window._paq = window._paq || []);
      /* tracker methods like "setCustomDimension" should be called before "trackPageView" */
      _paq.push(["trackPageView"]);
      _paq.push(["enableLinkTracking"]);
      (function () {
        var u = "//139-162-123-42.ip.linodeusercontent.com/";
        _paq.push(["setTrackerUrl", u + "matomo.php"]);
        _paq.push(["setSiteId", "1"]);
        var d = document,
          g = d.createElement("script"),
          s = d.getElementsByTagName("script")[0];
        g.async = true;
        g.src = u + "matomo.js";
        s.parentNode.insertBefore(g, s);
      })();
    </script>
  {/if}
</svelte:head>

{#if !cookieChecked}
  <main class="student-gate" aria-live="polite">
    <p>学生IDを確認しています…</p>
  </main>
{:else if studentId}
  {@render children()}
{:else}
  <main class="student-gate">
    <form onsubmit={identify}>
      <h1>あきこ</h1>
      <p>
        学生IDを入力してください。入力したIDの履修データをサーバーに保存します。
      </p>
      <label for="student-id">学生ID（s＋7桁の数字）</label>
      <input
        id="student-id"
        name="studentId"
        type="text"
        bind:value={studentIdInput}
        pattern={"s[0-9]{7}"}
        minlength="8"
        maxlength="8"
        placeholder="s1234567"
        autocomplete="off"
        autocapitalize="none"
        spellcheck="false"
        required
      />
      <button type="submit" disabled={!isStudentId(studentIdInput)}
        >開始する</button
      >
      <p>学生IDをCookieに保存し、次回から自動で読み込みます。</p>
    </form>
  </main>
{/if}

<style lang="scss">
  @use "$lib/fonts.scss";

  .student-gate {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 20px;
    box-sizing: border-box;

    form {
      max-width: 420px;
      display: grid;
      gap: 16px;
      padding: 28px;
      border: 1px solid #ddd;
      border-radius: 12px;
    }

    input,
    button {
      padding: 12px;
      font-size: 1rem;
    }
    h1,
    p {
      margin: 0;
    }
  }

  :global(:root) {
    --content-max-width: 800px;
  }

  :global {
    body,
    button,
    input,
    select {
      font-family: "M PLUS Rounded 1c", sans-serif;
    }

    button,
    label,
    input[type="checkbox"] {
      cursor: pointer;
    }

    button:disabled {
      cursor: not-allowed;
    }

    h1,
    h2,
    h3,
    h4,
    h5,
    h6,
    strong,
    th,
    dt {
      font-family: "M PLUS 1p", sans-serif;
    }

    body {
      margin: 0;
      padding: 0;
      padding-bottom: 50vh;
    }
  }
</style>
