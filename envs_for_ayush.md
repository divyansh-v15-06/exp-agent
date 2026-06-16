# Environment Variables for Ayush

Hey Ayush, here are all the environment variables we used to configure the Agent locally for the hackathon demo. 

**IMPORTANT SECURITY NOTE**: Make sure to remove these or swap them out for production keys when deploying. Do NOT leave these in the final production deployment.

```env
T3N_AGENT_PRIVATE_KEY=0x02529d879a81b511618cfaf28bed3db55b8f6abd0b78cd61f548c1ae298ab698
T3N_DEMO_BUYER_PRIVATE_KEY=0x11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff
DATABASE_URL="file:./dev.db"

# Gemini LLM Integration (Replaced Anthropic)
GEMINI_API_KEY=AQ.Ab8RN6KYY6lv92R-cgAgdmg8oDj_P7JorknScZq9ofjK8PEpUQ

# Stripe Connect Integration (Test Mode)
STRIPE_SECRET_KEY=sk_test_51TCzYR8iGRmogjncaXxCNpOVDqVZAPdr9FD1osFPfyyOLYjDiYrvxbpz4MOgCYLL4nb0uzwAz6ANaOfpxRTAaUFA00nWSQprmy
STRIPE_DESTINATIONS={"exporter-ref:acme-textiles-001":"acct_1TirxA8iGRP26vX8"}
```
