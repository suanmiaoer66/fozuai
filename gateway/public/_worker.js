// Pages can accept a custom subdomain while DNS stays with DNSPod.
// Service bindings call the existing Worker internally; API keys stay there.
export default {
  fetch(request, env) {
    return env.FOZU_API.fetch(request)
  },
}
