var _ = require('lodash');
var Etcd = require('node-etcd');
var util = require('util');
var q = require('q');
var logger = require('logsimple');

// specify the cluster to connect to
var PROXY_WATCHER_ETCD_CLUSTER_HOST = process.env.PROXY_WATCHER_ETCD_CLUSTER_HOST || '127.0.0.1';
var PROXY_WATCHER_ETCD_CLUSTER_PORT = process.env.PROXY_WATCHER_ETCD_CLUSTER_PORT || '4001';

// specify the path to listen on
var PROXY_WATCHER_ETCD_PATH = process.env.PROXY_WATCHER_ETCD_PATH;

// path to stick the compiled version of the 
var PROXY_WATCHER_CONFIG_PATH =  process.env.PROXY_WATCHER_CONFIG_PATH;

var TEMPLATE = process.argv[2];

// Check to make sure everything is set
if(!PROXY_WATCHER_ETCD_PATH){
	logger.error('args', 'Please set environment variable PROXY_WATCHER_ETCD_PATH');
	process.exit(1);
}

if(!PROXY_WATCHER_CONFIG_PATH){
	logger.error('args', 'Please set environment variable PROXY_WATCHER_CONFIG_PATH');
	process.exit(1);
}

if(process.argv[0] == 'node' && !process.argv[2]){
	console.log('useage: node proxy-watcher config.template');
	process.exit(1);
}

if(process.argv[0] != 'node' && !process.argv[1]){
	console.log('useage: proxy-watcher config.template');
	process.exit(1);
}

var etcd = new Etcd(PROXY_WATCHER_ETCD_CLUSTER_HOST, PROXY_WATCHER_ETCD_CLUSTER_PORT);

var watchForChanges = function(){

	var watcher = etcd.watcher(PROXY_WATCHER_ETCD_PATH, null, { recursive: true });
	watcher.on('change', function(modifiedNode){
		console.log(modifiedNode);
	});
};

var seedNodes = function(){
	var deferred = q.defer();

	etcd.get(PROXY_WATCHER_ETCD_PATH, { recursive: true }, function(err, node){
		if(err){
			logger.infoYellow('seed', 'Error seeding', err);
			return q.resolve();
		}
		var jsonNodes = [];
		if(node && node.node && node.node.nodes){
			_.each(node.node.nodes, function(service){
				var json;
				try {
					json = JSON.parse(service.value);
				} catch(e){}

				if(json){
					jsonNodes.push(json);
				}
			});

			buildAndReloadConfig()
		}
	});

	return deferred.promise;
};

/*
	Take a list of nodes and rebuild the config
	[{
		host: <hostname>,
		port: <port>
	}]
*/
var buildAndReloadConfig = function(nodes){

};

seedNodes().then(function(){

});