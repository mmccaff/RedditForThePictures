
/*
 * GET images on front page of reddit (/) or subreddit (/r/subreddit)
 */

var mongoose = require('mongoose');

var nodeio = require('node.io'), options = {timeout: 10, jsdom: true, max: 20, auto_retry: true};

// move these to a config file
if (process.env.NODE_ENV && process.env.MONGOLAB_URI)
{
	var mongoose = require('mongoose')
	  , db = mongoose.createConnection(process.env.MONGOLAB_URI);
}
else
{
	var mongoose = require('mongoose')
	  , db = mongoose.createConnection('localhost', 'reddit');
}


db.on('error', console.error.bind(console, 'connection error:'));

db.once('open', function () {
  console.log('Connected to MongoDB');
});

var imgSchema = new mongoose.Schema({
    display: { type: String, required: true },
	href: { type: String, required: true, index: { unique: true } },
	subreddit: { type: String }, // this is null if scraped from the front page
	created: { type: Date, default: Date.now }
});

var Image = db.model('Image', imgSchema);

function getJob(seed, pageLimit, myOptions)
{
	var currentPage = 1;
	var job = new nodeio.Job(options, {
	    input: [seed],
	    run: function (baseUrl) {
			var self = this;

	        self.getHtml(baseUrl, function (err, $) {
		        var links = [];
				var next = $("p.nextprev a:contains('next')").attr('href');

	            $('a.title').each(function (index, a) { 
						href = $(a).attr('href');
						display = $(a).text();
						links.push({'href' : href, 'display': display})
				});

				self.emit(links);

				currentPage++;

				// get images from the first pageLimit pages
				if (currentPage <= pageLimit)
				{
					// add next page as input to the job queue
					this.add(next);
				}

	        });
	    },
		reduce: function(inputLinks)
		{
			var imageLinks = [];

			inputLinks.forEach(function(link) {
				href = link['href'];
		        if (href.indexOf('.png') > 0 || href.indexOf('.jpg') > 0 || href.indexOf('.gif') > 0) 
				{
					// push to list that will be emitted to next step
					imageLinks.push(link); 
					
					// save to db
					saveImageLinkDetails(link, myOptions);   
				}
		    });

			this.emit(imageLinks);
		},
		output: function(inputLinks) {
			inputLinks.forEach(function(link) {
				console.log(link);
			});
		},
		complete: function(callback)
		{
			callback();
		}
	});

	return job;
}

function saveImageLinkDetails(link, myOptions)
{	
	var imageToSave;
	
	if (myOptions != null && myOptions['subreddit'] != null)
	{
		imageToSave = new Image({href: link['href'], display: link['display'], subreddit: myOptions['subreddit'] });	
	}
	else
	{
		imageToSave = new Image({href: link['href'], display: link['display'] });
	}

	imageToSave.save(function (err) {
	  if (err) 
	  {
		 if(err['code'] == 11000)
		 {
		    // non-unique href, do nothing	
		 }
		 else
		 {
			// unknown error
		 	console.log(err);
		 }
	  }
	});
	
}

/*
  It is worth noting that data is only pulled into the database for the front page or arbitrary subreddits at most once per day (if requested),
  and only unique hrefs are added.

  TODO: Uniqueness should be enforced on a composite key of (href, subreddit) not just href
        Queue up some setInterval jobs for front page and popular subreddits to keep data fresh without a user having to ask for it
		Paging via infinite scroll when many records exist in the db, allowing not just new data that was pulled in today to be shown
*/

exports.index = function(req, res){	
	var subreddit = req.params.subreddit;
	var seed = 'http://www.reddit.com';
	
	var dateToday = new Date();
	dateToday.setHours(0,0,0,0);

	var findCriteria = {created: {$gte: dateToday}};
	
	if(subreddit)
	{
		seed = 'http://www.reddit.com/r/' + subreddit;
		findCriteria = {subreddit: subreddit, created: {$gte: dateToday}};
	}
	
	// look for data in mongo from today, and then fall back on a live scrape
	Image.find(findCriteria).sort('-created').skip(0).limit(25).exec(function (err, data) {
	  console.log('Got ' + data.length + ' documents from db... ');
		
	  if (data.length > 0)
	  {
	  	res.render('index', { title: 'RedditForThePictures', links: data });
	  }
	  else
	  {
		// myOptions is passed to getJob, and then eventually to saveImageLinkDetails
		myOptions = subreddit ? {subreddit: subreddit } : null;
		
		nodeio.start(getJob(seed, 3, myOptions), options, function(err, inputLinks) {
			console.log('Got data from scraping...');
			res.render('index', { title: 'RedditForThePictures', links: inputLinks });
		}, true);
	  }
	});
}
