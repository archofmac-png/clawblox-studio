// Multi-agent collaboration example
import { ClawBloxClient, ClawBloxSession } from '../src';

async function main() {
  const client = new ClawBloxClient({ baseUrl: 'http://localhost:3001' });
  
  // Create two agents/sessions
  const [agentA, agentB] = await Promise.all([
    ClawBloxSession.create(client, { label: 'agent-a' }),
    ClawBloxSession.create(client, { label: 'agent-b' }),
  ]);
  
  console.log('Created sessions:', agentA.sessionId, agentB.sessionId);
  
  // Start both
  await Promise.all([agentA.start(), agentB.start()]);
  
  // Execute something in agentA
  const resultA = await agentA.execute('print("Hello from A!")');
  console.log('Agent A result:', resultA);
  
  // Send a message from A to B
  await agentA.sendMessage(agentB.sessionId, 'ping', { data: 42 });
  console.log('Message sent from A to B');
  
  // Check B's messages
  const messages = await agentB.getMessages();
  console.log('Agent B received messages:', messages);
  
  // Cleanup
  await Promise.all([agentA.destroy(), agentB.destroy()]);
  console.log('Sessions destroyed');
}

main().catch(console.error);
