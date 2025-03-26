# ACAC - All Common Ancestors Considered

ACAC is a tool that, in conjunction with the genealogical database maintained by geni.com, will allow you to quickly focus in on potential common ancestors for a group of people.
This function can have multiple applications, but the driving use case is to interpret DNA information: If you know that a certain set of people match you on a specific DNA segment, you can be reasonably confident that this segment is inherited from a single ancestor.
If this single ancestor is present in the database, and linked to all descendants, ACAC will in many cases be able to identify the ancestor or ancestor pair correctly.
If either condition is not fulfilled, ACAC can at least group the DNA matches into clusters that share ancestors; these may be a basis for further research.

ACAC uses a local cache on the user's computer to store information retrieved from geni.com using the user's credentials; it stores no information on the ACAC server, and does not log any information about the user.

ACAC is written in Javascript, and executes entirely in the user's Web browser.
