# Recorded call occurrences

History position and execution-local brackets are two addresses for recorded
calls. A provider ID can recur at either address. This reader keeps each
address, uses the recorded order inside an execution, and leaves missing
counterparts unpaired.

Only a matching history projection or a unique compatible candidate supplies
a link from an event occurrence to committed history. A consumer uses that
link to read evidence by its original coordinate. The reader works on saved
data and has no dispatch, event or state writer.
