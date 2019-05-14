/**
 * WARNING: There's no "room-user" relationship storage management in this example.
 */

const baseAbsPath = __dirname + '/';

function findUser(wsSessionHandshake) {
  // TODO: Make a genuine authentication.
  const userId = wsSessionHandshake.query.userid;
  return {
    id: userId
  };
}

const log4js = require('log4js');
log4js.configure({
  appenders: {
    console: { type: 'console' }
  },
  categories: {
    default: { appenders: ['console'], level: 'debug' }
  }
});

const cluster = require('cluster');
const crypto = require('crypto');
const numCPUs = require('os').cpus().length;


if (cluster.isMaster) {
  const logger = log4js.getLogger();

  let uidToWsSession = {};
  logger.debug(`Master pid == ${process.pid} is running`);

  const roomidToWorkerId = {};
  const roomidToWorkerIdMaxLifeMillis = (60 * 60 * 1000); // Not used yet in the current example.
  function findWorkerForRoom(roomid) {
    if (undefined === cluster.workers || null === cluster.workers) return null;

    if (0 == cluster.workers.length) return null;

    logger.debug(`Finding a worker process for roomid == ${roomid}.`);

    if (!roomidToWorkerId.hasOwnProperty(roomid)) {
      const nWorkers = Object.keys(cluster.workers).length;
      logger.debug(`There is no cached worker for this room. Arranging among ${nWorkers} workers.`);
      const workerId = ((roomid % nWorkers) + 1);
      logger.debug(`Chosen worker id == ${workerId}.`);
      roomidToWorkerId[roomid] = {
        workerId: workerId,
        createdAt: Date.now(),
      };

      return cluster.workers[workerId];
    } else {
      const workerId = roomidToWorkerId[roomid].workerId;
      logger.debug(`There is a cached worker.id == ${workerId} for this room.`);
      return cluster.workers[workerId];
    }
  }

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    logger.warn(`Worker pid == ${worker.process.pid} died`);
  });

  const host = 'localhost';
  const port = 3000;
  const httpServer = require('http').createServer();
  /*
   * Initialization of `socket.io-server` under a `worker-process` launched & managed by `pm2`. 
   *
   * - The socket.io-server will reset its session watchdog for another "(pingInterval + pingTimeout)", within which ANY packet from the client side (including but not limited to "ping") should be received to maintain the session, and as well reset the session watchdog. Hence "pingInterval" is recommended to be way less than "pingTimeout" to ensure sufficient tolerance of packet loss.  
   */
  const io = require('socket.io')(httpServer, {
    path: '/sio',
    pingInterval: 200,
    pingTimeout: 2000
  });
  httpServer.listen(port, host, 1024, (err) => {
    if (null != err) {
      logger.error(err);
      return;
    }

    logger.info("Listening on ", host, ":", port);
    io.use((wsSession, next) => {
      const user = findUser(wsSession.handshake);
      if (!user) return next(new Error("Authentication error"));
      wsSession.user = user;
      return next();
    });
    io.on('connect', (wsSession) => {
      const uid = wsSession.user.id;
      const roomid = parseInt(wsSession.handshake.query.roomid);
      logger.info(`Authenticated connection attempted for roomid == ${roomid} from uid == ${uid}.`);
      const worker = findWorkerForRoom(roomid);
      if (!worker) {
        try {
          wsSession.disconnect(true);
        } catch (err) {
          logger.error(err);
        } finally {
          logger.warn(`For uid == ${uid} and roomid == ${roomid}, no forked process is found.`);
        }
        return;
      }
      uidToWsSession[uid] = wsSession;    // In the current example, a "wsSession" WON'T be bound to another "worker a.k.a. forked process".    

      worker.send({
        fromUserId: uid,
        roomid: roomid,
        taskType: 'join',
        taskState: 'completed', // For echoing.
      });

      wsSession.on("message", (msg) => {
        logger.debug(`Received message ${JSON.stringify(msg)} from a wsSession managed by worker.id == ${worker.id}.`);
        const toEchoMsg = {
          fromUserId: uid,
          taskType: 'echo',
        };
        // As a reverse-proxy.
        worker.send(toEchoMsg);     
      });
      wsSession.on('disconnect', (reason) => {
        logger.warn(`For uid == ${uid} in roomid == ${roomid}, the wsSession is disconnected.`);
        delete uidToWsSession[uid];
        logger.warn(`For uid == ${uid}, the "uid->wsSession" cache is cleared.`);
      });
      wsSession.on('error', (sessionErr) => {
        logger.error(`For uid == ${uid} in roomid == ${roomid}, a session error occurred ${sessionErr}.`);
        try {
          // In the current example, the following simple approach is used to trigger `wsSession.on('disconnect')`.        
          wsSession.disconnect(true);
        } catch (err) {
          logger.error(`For uid == ${uid} and roomid == ${roomid}, cannot be disconnected after a session error because ${err}.`);
        } finally {
          delete uidToWsSession[uid];
          logger.warn(`For uid == ${uid}, the "uid->wsSession" cache is cleared.`);
        }
      });
    });

    cluster.on('message', function (worker, msg, handle) {
      logger.debug(`Master received a messsage ${JSON.stringify(msg)} from worker.id == ${worker.id}.`);
      if (msg.roomDismissed) {
        const roomid = msg.roomid;
        delete roomidToWorker[roomid];
        return;
      }

      const toUserId = msg.toUserId;
      const wsSession = uidToWsSession[toUserId];

      if (msg.userExpelled) {
        // In the current example, the following simple approach is used to trigger `wsSession.on('disconnect')`.        
        wsSession.disconnect(true);
        return;
      }

      if ('completed' == msg.taskState) {
        logger.debug(`Master is reversely proxying back the message to uid == ${toUserId}.`);
        // As a reverse-proxy.
        wsSession.emit("unicastedFrame", msg);
      }
    });
  });

  process.on('uncaughtException', (err) => { 
    logger.error(err.stack);
  });
} else {
  const selfWorkerId = cluster.worker.id;
  const roomDict = {};

  process.on('message', function (msg) {
    const fromUserId = msg.fromUserId;
    console.log(`Worker.id == ${selfWorkerId} with pid == ${process.pid} received reversely proxied message ${JSON.stringify(msg)}. Echoing back to uid == ${fromUserId}.`);

    if ('echo' == msg.taskType) {
      const toEchoMsg = {
        fromWorkerId: selfWorkerId,
        toUserId: fromUserId,
        taskState: 'completed',
      };
      Object.assign(toEchoMsg, msg);
      console.log(`Echoing back ${toEchoMsg}.`);
      process.send(toEchoMsg);
    }

  });

  process.on('uncaughtException', (err) => { 
    console.error(err.stack);
  });
}

