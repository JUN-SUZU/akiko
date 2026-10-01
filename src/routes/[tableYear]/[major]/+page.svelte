<script lang="ts">
  import MajorApp from "$lib/MajorApp.svelte";
  import ClosedNotice from "$lib/ClosedNotice.svelte";
  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

{#if data.closed}
  <ClosedNotice name={data.majorJa} />
{:else}
  {#key `${data.config.major}_${data.config.tableYear}`}
    <MajorApp config={data.config} />
  {/key}
{/if}
